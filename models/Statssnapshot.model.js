/**
 * StatsSnapshot.js
 * ------------------------------------------------------------------
 * One document = one point-in-time snapshot of the live INJ / network
 * stats. The scheduler (services/snapshot.scheduler.js) inserts a new
 * document every SNAPSHOT_INTERVAL_MINUTES, and the /history + /compare
 * endpoints read from this collection.
 *
 * Field names match exactly what Dashboard.jsx expects on each
 * snapshot object (see the "stats" object used by StatCard, Sparkline,
 * the history table, and the CSV export).
 * ------------------------------------------------------------------
 */

import mongoose from "mongoose";

const StatsSnapshotSchema = new mongoose.Schema(
  {
    // ---- Price (multi-currency) ----
    injPriceUsd: { type: Number, default: null },
    injPricePkr: { type: Number, default: null },
    injPriceEur: { type: Number, default: null },
    injPriceGbp: { type: Number, default: null },
    injPriceChange24h: { type: Number, default: null }, // percent

    // ---- 24h range ----
    high24hUsd: { type: Number, default: null },
    low24hUsd: { type: Number, default: null },

    // ---- Supply / market cap ----
    marketCapUsd: { type: Number, default: null },
    circulatingSupply: { type: Number, default: null },
    totalSupply: { type: Number, default: null },
    netSupplyChangeInj: { type: Number, default: null }, // vs genesis 100M INJ

    // ---- Staking ----
    totalStakedInj: { type: Number, default: null },
    stakingAprPercent: { type: Number, default: null },

    // ---- Volume ----
    helixVolume24hUsd: { type: Number, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Fast range queries or ordering by time
StatsSnapshotSchema.index({ createdAt: -1 });

export default mongoose.model("StatsSnapshot", StatsSnapshotSchema);