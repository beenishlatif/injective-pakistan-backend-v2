import express from "express";
import { getLiveStats, getPriceHistory } from "../controllers/stats.controller.js";

const router = express.Router();

router.get("/", getLiveStats);
router.get("/history", getPriceHistory);

export default router;