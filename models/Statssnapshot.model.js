/**
 * StatsSnapshot.model.js
 * ------------------------------------------------------------------
 * Mongoose model. Every time we pull live numbers (price, staked,
 * burned, volume...) from our data sources, we save ONE row here.
 * That gives us a time-series collection we can query later to draw
 * charts on the Dashboard (1H / 24H / 7D / 30D views).
 *
 * Collection: statssnapshots (Mongoose auto-pluralizes "StatsSnapshot")
 * ------------------------------------------------------------------
 */

const mongoose = require("mongoose");

const StatsSnapshotSchema = new mongoose.Schema(
  {
    // Live INJ price in USD (source: CoinGecko)
    injPriceUsd: { type: Number, default: null },

    // 24h price change, in percent, e.g. 3.42 or -1.15
    injPriceChange24h: { type: Number, default: null },

    // Market cap in USD
    marketCapUsd: { type: Number, default: null },

    // Circulating supply, in INJ
    circulatingSupply: { type: Number, default: null },

    // Total INJ currently bonded/staked on the chain
    // (source: Injective LCD -> /cosmos/staking/v1beta1/pool)
    totalStakedInj: { type: Number, default: null },

    // Cumulative INJ burned via the weekly buy-back-and-burn auction.
    // There isn't one single public endpoint for this number, so it's
    // usually populated either manually, from a burn-auction indexer,
    // or approximated as (max supply - circulating supply). See the
    // comment above fetchBurnedInj() in stats.controller.js.
    totalBurnedInj: { type: Number, default: null },

    // Helix (injective DEX) 24h trading volume in USD
    helixVolume24hUsd: { type: Number, default: null },

    // When this snapshot was captured. Indexed since almost every
    // query on this collection is "give me rows after/before X".
    capturedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

// Fast lookups for "give me the latest snapshot" and range queries.
StatsSnapshotSchema.index({ capturedAt: -1 });

module.exports =
  mongoose.models.StatsSnapshot ||
  mongoose.model("StatsSnapshot", StatsSnapshotSchema);