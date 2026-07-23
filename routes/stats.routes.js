/**
 * stats.routes.js
 * ------------------------------------------------------------------
 * Mount this router TWICE in your main server file (app.js / index.js):
 *
 *   import statsRoutes from "./routes/stats.routes.js";
 *   app.use("/api/home", statsRoutes);       // -> GET /api/home/stats (INJ only)
 *   app.use("/api/dashboard", statsRoutes);  // -> GET /api/dashboard/tokens
 *                                             // -> GET /api/dashboard/stats?token=...
 *                                             // -> GET /api/dashboard/history?token=...
 *
 * Home.jsx only ever calls GET /api/home/stats (current INJ snapshot,
 * no ?token needed -- defaults to INJ automatically).
 * Dashboard.jsx calls /api/dashboard/tokens (to populate the token
 * selector), /api/dashboard/stats (current snapshot for the selected
 * token) and /api/dashboard/history (chart data for the selected
 * token) -- same controller, all three mounts share one in-memory
 * cache (keyed per token) so we're not double-fetching CoinGecko.
 * ------------------------------------------------------------------
 */

import express from "express";
import * as statsController from "../controllers/stats.controller.js";

const router = express.Router();

// GET /tokens -> list of supported tokens (id/symbol/name) for the selector
router.get("/tokens", statsController.getTokens);

// GET /stats?token=bitcoin -> current live/cached stats snapshot
router.get("/stats", statsController.getStats);

// GET /history?token=bitcoin&range=1h|24h|7d|30d&metric=priceUsd -> chart data
// (only meaningful under the /api/dashboard mount, but harmless if
// also reachable under /api/home)
router.get("/history", statsController.getHistory);

export default router;