// server/routes/auth.routes.js
// ------------------------------------------------------------------
// All THREE login methods live here now:
//   POST   /api/auth/register     (email + password)
//   POST   /api/auth/login        (email + password)
//   POST   /api/auth/google       (Google Identity Services idToken)
//   GET    /api/auth/me           (requires Bearer token)
//   GET    /api/auth/x/login      (X OAuth2 popup flow, unchanged logic)
//   GET    /api/auth/x/callback
//
// Env vars needed:
//   JWT_SECRET        - always required
//   FRONTEND_URL       - always required
//   X_CLIENT_ID, X_CLIENT_SECRET, X_CALLBACK_URL   - for X login
//   GOOGLE_CLIENT_ID                                - for Google login
//     (this is the BACKEND's copy of the same client ID used by
//      VITE_GOOGLE_CLIENT_ID on the frontend — they must match)
//
// TEMP DEBUG (remove once register/google 500 errors are fixed):
// register/login/google catch blocks now include `err.message` in the
// JSON response so the real MongoDB/validation error is visible from
// the client (curl/Postman/browser) without needing to open Vercel
// Runtime Logs. Revert this before shipping to real users, since it
// can leak internal details.
// ------------------------------------------------------------------
import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import axios from "axios";
import User from "../models/user.model.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) console.error(`[auth.routes] Missing env vars: ${missing.join(", ")}`);
  return missing;
}
requireEnv(["JWT_SECRET", "FRONTEND_URL"]);

function signToken(userId) {
  return jwt.sign({ userId: userId.toString() }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

/* ================================================================
   EMAIL + PASSWORD
   ================================================================ */

router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Email and password are required." });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: "Password must be at least 6 characters." });
    }

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ success: false, error: "An account with this email already exists." });
    }

    const user = await User.create({
      name: name?.trim() || email.split("@")[0],
      email: email.toLowerCase().trim(),
      password,
    });

    const token = signToken(user._id);
    return res.status(201).json({ success: true, token, user: user.toSafeJSON() });
  } catch (err) {
    console.error("[auth.routes] register error:", err);
    // TEMP DEBUG: exposing err.message so the real cause is visible
    // without digging through Vercel logs. Remove `debug` field later.
    return res.status(500).json({ success: false, error: "Could not create account.", debug: err.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Email and password are required." });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select("+password");
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, error: "Invalid email or password." });
    }

    const token = signToken(user._id);
    return res.status(200).json({ success: true, token, user: user.toSafeJSON() });
  } catch (err) {
    console.error("[auth.routes] login error:", err);
    return res.status(500).json({ success: false, error: "Could not sign in.", debug: err.message });
  }
});

/* ================================================================
   GOOGLE
   ================================================================ */

router.post("/google", async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ success: false, error: "Missing Google idToken." });
    }
    if (!process.env.GOOGLE_CLIENT_ID) {
      console.error("[auth.routes] GOOGLE_CLIENT_ID not set on backend");
      return res.status(500).json({ success: false, error: "Google sign-in is not configured on the server." });
    }

    // Verify the idToken with Google directly (no extra SDK dependency needed).
    const verifyRes = await axios.get("https://oauth2.googleapis.com/tokeninfo", {
      params: { id_token: idToken },
    });
    const payload = verifyRes.data;

    if (payload.aud !== process.env.GOOGLE_CLIENT_ID) {
      return res.status(401).json({ success: false, error: "Google token was not issued for this app." });
    }

    let user = await User.findOne({ googleId: payload.sub });
    if (!user) {
      // If an account already exists with this email (e.g. registered via
      // email/password earlier), link Google to it instead of duplicating.
      user = await User.findOne({ email: payload.email });
      if (user) {
        user.googleId = payload.sub;
        if (!user.avatar) user.avatar = payload.picture;
        await user.save();
      } else {
        user = await User.create({
          googleId: payload.sub,
          email: payload.email,
          name: payload.name,
          avatar: payload.picture,
        });
      }
    }

    const token = signToken(user._id);
    return res.status(200).json({ success: true, token, user: user.toSafeJSON() });
  } catch (err) {
    console.error("[auth.routes] google error:", err?.response?.data || err.message);
    return res.status(401).json({ success: false, error: "Google sign-in failed.", debug: err.message });
  }
});

/* ================================================================
   CURRENT USER
   ================================================================ */

router.get("/me", requireAuth, async (req, res) => {
  return res.status(200).json({ success: true, user: req.user.toSafeJSON() });
});

/* ================================================================
   X / TWITTER OAUTH (unchanged PKCE-in-state logic, still stateless
   so it works fine across multiple serverless instances)
   ================================================================ */

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function base64urlDecodeToString(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf8");
}
function signState(payloadObj) {
  const payload = base64url(Buffer.from(JSON.stringify(payloadObj), "utf8"));
  const sig = base64url(crypto.createHmac("sha256", process.env.JWT_SECRET).update(payload).digest());
  return `${payload}.${sig}`;
}
function verifyAndDecodeState(state) {
  if (typeof state !== "string" || !state.includes(".")) return null;
  const [payload, sig] = state.split(".");
  const expectedSig = base64url(crypto.createHmac("sha256", process.env.JWT_SECRET).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const decoded = JSON.parse(base64urlDecodeToString(payload));
    if (!decoded?.v || !decoded?.exp || Date.now() > decoded.exp) return null;
    return decoded;
  } catch {
    return null;
  }
}

function popupResponseHtml({ success, token, message, frontendUrl }) {
  const payload = success
    ? { type: "x-oauth-success", token }
    : { type: "x-oauth-error", message: message || "auth_failed" };
  const fallbackUrl = success
    ? `${frontendUrl}/game?token=${encodeURIComponent(token)}`
    : `${frontendUrl}/game?error=${encodeURIComponent(message || "auth_failed")}`;

  return `<!DOCTYPE html>
<html>
  <body>
    <script>
      (function () {
        var payload = ${JSON.stringify(payload)};
        var targetOrigin = ${JSON.stringify(frontendUrl)};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, targetOrigin);
            window.close();
            return;
          }
        } catch (e) {}
        window.location.href = ${JSON.stringify(fallbackUrl)};
      })();
    </script>
  </body>
</html>`;
}

router.get("/x/login", (req, res) => {
  const missing = requireEnv(["X_CLIENT_ID", "X_CLIENT_SECRET", "X_CALLBACK_URL"]);
  if (missing.length > 0) {
    return res.status(500).send(
      popupResponseHtml({
        success: false,
        message: "server_misconfigured",
        frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
      })
    );
  }

  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
  const state = signState({ v: codeVerifier, exp: Date.now() + STATE_TTL_MS });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.X_CLIENT_ID,
    redirect_uri: process.env.X_CALLBACK_URL,
    scope: "tweet.read users.read offline.access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  res.redirect(`https://twitter.com/i/oauth2/authorize?${params.toString()}`);
});

router.get("/x/callback", async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL;

  try {
    const { code, state, error: xError } = req.query;

    if (xError) {
      return res.send(popupResponseHtml({ success: false, message: "auth_denied", frontendUrl }));
    }

    const decodedState = verifyAndDecodeState(state);
    if (!decodedState) {
      return res.send(popupResponseHtml({ success: false, message: "invalid_state", frontendUrl }));
    }
    const codeVerifier = decodedState.v;

    const tokenRes = await axios.post(
      "https://api.twitter.com/2/oauth2/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.X_CALLBACK_URL,
        code_verifier: codeVerifier,
        client_id: process.env.X_CLIENT_ID,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:
            "Basic " + Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64"),
        },
      }
    );

    const { access_token } = tokenRes.data;

    const profileRes = await axios.get(
      "https://api.twitter.com/2/users/me?user.fields=profile_image_url,name,username",
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    const xUser = profileRes.data.data;

    const user = await User.findOneAndUpdate(
      { xId: xUser.id },
      {
        $setOnInsert: { xId: xUser.id },
        $set: {
          username: xUser.username,
          displayName: xUser.name,
          name: xUser.name,
          avatar: xUser.profile_image_url,
        },
      },
      { new: true, upsert: true }
    );

    const token = signToken(user._id);
    return res.send(popupResponseHtml({ success: true, token, frontendUrl }));
  } catch (err) {
    console.error("X OAuth callback error:", err?.response?.data || err.message);
    return res.send(popupResponseHtml({ success: false, message: "auth_failed", frontendUrl }));
  }
});

export default router;