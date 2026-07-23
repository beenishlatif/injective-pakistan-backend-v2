/**
 * stats.routes.js
 * ------------------------------------------------------------------
 * Mount this router TWICE in your main server file (app.js / index.js):
 *
 *   const statsRoutes = require("./routes/stats.routes");
 *   app.use("/api/home", statsRoutes);       // -> GET /api/home/stats
 *   app.use("/api/dashboard", statsRoutes);  // -> GET /api/dashboard/stats
 *                                             // -> GET /api/dashboard/history
 *
 * Home.jsx only ever calls GET /api/home/stats (current snapshot).
 * Dashboard.jsx calls both /api/dashboard/stats (current) and
 * /api/dashboard/history (chart data) — same controller, both mounts
 * share one in-memory cache so we're not double-fetching CoinGecko.
 * ------------------------------------------------------------------
 */

const express = require("express");
const router = express.Router();
const statsController = require("../controllers/stats.controller");

// GET /stats -> current live/cached stats snapshot
router.get("/stats", statsController.getStats);

// GET /history?range=1h|24h|7d|30d&metric=injPriceUsd -> chart data
// (only meaningful under the /api/dashboard mount, but harmless if
// also reachable under /api/home)
router.get("/history", statsController.getHistory);

module.exports = router;