/**
 * StatsSnapshot.model.js
 * ------------------------------------------------------------------
 * Mongoose model. Every time we pull live numbers for a given token
 * (price, market cap, volume, supply...) from CoinGecko (+ Injective
 * LCD for staking, INJ-only), we save ONE row here, tagged with the
 * token's CoinGecko id. That gives us a per-token time-series
 * collection we can query later to draw charts on the Dashboard
 * (1H / 24H / 7D / 30D views, any supported token).
 *
 * Collection: statssnapshots (Mongoose auto-pluralizes "StatsSnapshot")
 * ------------------------------------------------------------------
 */

import mongoose from "mongoose";

const StatsSnapshotSchema = new mongoose.Schema(
  {
    // CoinGecko id, e.g. "bitcoin", "injective-protocol". Every query
    // on this collection filters by tokenId first, so it's indexed.
    tokenId: { type: String, required: true, index: true },
    tokenSymbol: { type: String, default: null }, // e.g. "BTC"
    tokenName: { type: String, default: null }, // e.g. "Bitcoin"

    // ---------------- generic market data (any token, via CoinGecko) ----------------
    priceUsd: { type: Number, default: null },
    priceChange24h: { type: Number, default: null }, // percent, e.g. 3.42 or -1.15
    marketCapUsd: { type: Number, default: null },
    marketCapRank: { type: Number, default: null },
    volume24hUsd: { type: Number, default: null },
    circulatingSupply: { type: Number, default: null },
    totalSupply: { type: Number, default: null },
    maxSupply: { type: Number, default: null },
    athUsd: { type: Number, default: null }, // all-time high price
    athChangePercent: { type: Number, default: null }, // % below/above ATH

    // ---------------- Injective-only fields (null for every other token) ----------------
    // Total INJ currently bonded/staked on the chain
    // (source: Injective LCD -> /cosmos/staking/v1beta1/pool)
    totalStakedInj: { type: Number, default: null },

    // Cumulative INJ burned via the weekly buy-back-and-burn auction.
    // There isn't one single public endpoint for this number, so it's
    // approximated as (max supply - circulating supply). See the
    // comment above estimateBurnedInj() in stats.controller.js.
    totalBurnedInj: { type: Number, default: null },

    // When this snapshot was captured. Almost every query on this
    // collection is "give me rows for tokenId after/before X".
    capturedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

// Fast lookups for "give me the latest snapshot for token X" and
// per-token range queries for the chart.
StatsSnapshotSchema.index({ tokenId: 1, capturedAt: -1 });

export default mongoose.models.StatsSnapshot ||
  mongoose.model("StatsSnapshot", StatsSnapshotSchema);