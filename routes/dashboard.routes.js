/**
 * dashboard.routes.js
 * ------------------------------------------------------------------
 * GET /api/dashboard/live               -> current INJ price/market snapshot
 * GET /api/dashboard/history?range=24h  -> historical points for the chart
 *
 * Mount in server.js:
 *   import dashboardRoutes from "./routes/dashboard.routes.js";
 *   app.use("/api/dashboard", dashboardRoutes);
 * ------------------------------------------------------------------
 */

import { Router } from "express";
import { getLiveStats, getPriceHistory } from "../controllers/dashboard.controller.js";

const router = Router();

router.get("/live", getLiveStats);
router.get("/history", getPriceHistory);

export default router;