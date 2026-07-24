/**
 * stats.routes.js
 * ------------------------------------------------------------------
 * Mounted twice in server.js:
 *   app.use("/api/stats", statsRoutes);
 *   app.use("/api/dashboard", statsRoutes);
 *
 * so every route below is reachable at both /api/stats/... and
 * /api/dashboard/..., matching exactly what Dashboard.jsx (apiBaseUrl
 * + "/api/dashboard/...") calls.
 * ------------------------------------------------------------------
 */

import { Router } from "express";
import {
  getLiveStats,
  getHistory,
  getCompare,
  getNetworkStatus,
  getValidators,
  getGovernance,
  getFearGreed,
  getEcosystem,
  getSummary,
} from "../controllers/stats.controller.js";

const router = Router();

router.get("/live", getLiveStats);
router.get("/history", getHistory);
router.get("/compare", getCompare);
router.get("/network", getNetworkStatus);
router.get("/validators", getValidators);
router.get("/governance", getGovernance);
router.get("/feargreed", getFearGreed);
router.get("/ecosystem", getEcosystem);
router.get("/summary", getSummary);

export default router;