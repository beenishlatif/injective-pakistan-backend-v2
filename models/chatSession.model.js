/**
 * chatSession.model.js
 * ------------------------------------------------------------------
 * Mongoose model used to persist every chat conversation so old
 * chats survive server restarts / page reloads and can be listed in
 * the frontend's "History" sidebar.
 *
 * Every session now belongs to exactly one logged-in user (userId).
 * Guest (not-logged-in) conversations are never written to this
 * collection at all — see ai.controller.js.
 * ------------------------------------------------------------------
 */

import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
  },
  { _id: false, timestamps: { createdAt: true, updatedAt: false } }
);

const chatSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, default: "New conversation" },
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true } // adds createdAt + updatedAt
);

const ChatSession = mongoose.model("ChatSession", chatSessionSchema);

export default ChatSession;