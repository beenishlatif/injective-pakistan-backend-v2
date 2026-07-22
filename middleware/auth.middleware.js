// server/middleware/auth.middleware.js
// ------------------------------------------------------------------
// THE BUG THIS FIXES:
// The old version only did `req.userId = decoded.userId`. Every
// controller (ai.controller.js, sessions routes) reads `req.user._id`,
// which was always undefined -> crashed -> "Could not load chat
// history." This version fetches the full User doc and sets
// `req.user`, matching what the controllers expect.
// ------------------------------------------------------------------
import jwt from "jsonwebtoken";
import User from "../models/user.model.js";

// Strict: must be logged in, or request is rejected. Use for
// /api/ai/sessions (list/get/delete) and /api/auth/me.
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

  if (!token) {
    return res.status(401).json({ success: false, message: "You must be logged in." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ success: false, message: "Session expired, please reconnect." });
    }
    req.user = user;
    req.userId = user._id.toString();
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Session expired, please reconnect." });
  }
}

// Lenient: guests are allowed through with req.user = null. Logged-in
// users get req.user populated. Use for /api/ai/chat and
// /api/ai/chat/stream, so guests can still chat (just without history
// being saved) and logged-in users get their chat persisted.
export async function attachUserIfPresent(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    req.user = user || null;
  } catch {
    req.user = null;
  }
  next();
}

// Default export kept for backwards compatibility with any existing
// `import requireAuth from ".../auth.middleware.js"` usage.
export default requireAuth;