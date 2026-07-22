// server/routes/auth.routes.js
import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import axios from "axios";
import User from "../models/user.model.js";

const router = express.Router();

const REQUIRED_ENV = [
  "X_CLIENT_ID",
  "X_CLIENT_SECRET",
  "X_CALLBACK_URL",
  "JWT_SECRET",
  "FRONTEND_URL",
];
function getMissingEnv() {
  return REQUIRED_ENV.filter((key) => !process.env[key]);
}
const missingAtLoad = getMissingEnv();
if (missingAtLoad.length > 0) {
  console.error(`[auth.routes] Missing env vars: ${missingAtLoad.join(", ")}`);
}

// ------------------------------------------------------------------
// PKCE state handling — STATELESS.
// ------------------------------------------------------------------
// Previously the code_verifier was kept in an in-memory Map keyed by
// `state`. That breaks the moment /x/login and /x/callback are
// handled by two different server instances (serverless functions,
// multiple dynos/pods, PM2 cluster, a redeploy in between, etc.) —
// which is very likely on platforms like Vercel. The second request
// simply wouldn't find the verifier and every login would randomly
// fail with "invalid_state".
//
// Instead, we pack {verifier, expiry} into the `state` param itself,
// HMAC-signed with JWT_SECRET so it can't be tampered with. No server
// memory needed at all, so it works no matter how many instances are
// running or how they're distributed.
// ------------------------------------------------------------------

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function base64url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function base64urlDecodeToString(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf8");
}

function signState(payloadObj) {
  const payload = base64url(Buffer.from(JSON.stringify(payloadObj), "utf8"));
  const sig = base64url(
    crypto.createHmac("sha256", process.env.JWT_SECRET).update(payload).digest()
  );
  return `${payload}.${sig}`;
}

function verifyAndDecodeState(state) {
  if (typeof state !== "string" || !state.includes(".")) return null;
  const [payload, sig] = state.split(".");
  const expectedSig = base64url(
    crypto.createHmac("sha256", process.env.JWT_SECRET).update(payload).digest()
  );
  // Constant-time comparison to avoid timing attacks.
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const decoded = JSON.parse(base64urlDecodeToString(payload));
    if (!decoded?.v || !decoded?.exp || Date.now() > decoded.exp) return null;
    return decoded; // { v: codeVerifier, exp: timestamp }
  } catch {
    return null;
  }
}

/* Small HTML helper: talks back to the tab that opened this popup via
   postMessage, then closes itself. Falls back to a normal redirect if
   the popup was blocked and this ended up as a full-page navigation. */
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
        // No opener (popup blocked / opened directly) -> normal redirect.
        // Note: this puts the token in the URL as a last-resort fallback
        // (history/referrer exposure). The postMessage path above avoids
        // this entirely and is what runs in the normal popup flow.
        window.location.href = ${JSON.stringify(fallbackUrl)};
      })();
    </script>
  </body>
</html>`;
}

// Step A: send the user to X's authorize screen (opened in a popup by the frontend)
router.get("/x/login", (req, res) => {
  const missing = getMissingEnv();
  if (missing.length > 0) {
    console.error(`[x/login] Cannot start OAuth, missing: ${missing.join(", ")}`);
    return res
      .status(500)
      .send(
        popupResponseHtml({
          success: false,
          message: "server_misconfigured",
          frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
        })
      );
  }

  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(
    crypto.createHash("sha256").update(codeVerifier).digest()
  );

  // The verifier travels inside the signed `state` param instead of a
  // server-side Map — see the block comment above.
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

// Step B: X redirects back here (still inside the popup)
router.get("/x/callback", async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL;

  try {
    const { code, state, error: xError } = req.query;

    if (xError) {
      return res.send(
        popupResponseHtml({ success: false, message: "auth_denied", frontendUrl })
      );
    }

    const decodedState = verifyAndDecodeState(state);
    if (!decodedState) {
      return res.send(
        popupResponseHtml({ success: false, message: "invalid_state", frontendUrl })
      );
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
            "Basic " +
            Buffer.from(
              `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`
            ).toString("base64"),
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
          avatar: xUser.profile_image_url,
        },
      },
      { new: true, upsert: true }
    );

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    return res.send(popupResponseHtml({ success: true, token, frontendUrl }));
  } catch (err) {
    console.error("X OAuth callback error:", err?.response?.data || err.message);
    return res.send(
      popupResponseHtml({ success: false, message: "auth_failed", frontendUrl })
    );
  }
});

export default router;