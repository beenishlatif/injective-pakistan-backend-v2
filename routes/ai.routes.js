/**
 * ai.routes.js
 * ------------------------------------------------------------------
 * THE BUG THIS FIXES:
 * - /sessions routes had NO auth middleware at all, so req.user was
 *   always undefined and listSessions/getSession/deleteSession
 *   crashed -> "Could not load chat history."
 * - /chat and /chat/stream referenced (in comments) an
 *   `attachUserIfPresent` middleware that was never actually wired
 *   in, so logged-in users' chats were never being tied to req.user.
 *
 * Requires: npm install express express-rate-limit mongoose
 * ------------------------------------------------------------------
 */

import express from "express";
import rateLimit from "express-rate-limit";
import {
  handleChat,
  handleChatStream,
  listSessions,
  getSession,
  deleteSession,
} from "../controllers/ai.controller.js";
import { requireAuth, attachUserIfPresent } from "../middleware/auth.middleware.js";

const router = express.Router();

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many requests. Please wait a moment before asking again.",
  },
});

// Guests AND logged-in users can chat. attachUserIfPresent sets
// req.user when a valid token is sent, and req.user = null otherwise
// (never blocks the request either way).
router.post("/chat", chatLimiter, attachUserIfPresent, handleChat);
router.post("/chat/stream", chatLimiter, attachUserIfPresent, handleChatStream);

// Chat history — must be logged in, always scoped to req.user._id.
router.get("/sessions", requireAuth, listSessions);
router.get("/sessions/:sessionId", requireAuth, getSession);
router.delete("/sessions/:sessionId", requireAuth, deleteSession);

export default router;