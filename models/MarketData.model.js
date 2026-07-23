/**
 * MarketData.model.js
 * ------------------------------------------------------------------
 * Caches live Injective (INJ) market data fetched from CoinGecko so the
 * dashboard doesn't hammer their public API on every page load, and so
 * the site keeps working (serving the last known snapshot) if CoinGecko
 * is briefly unreachable.
 *
 * This is a SINGLETON collection — only one document should ever exist,
 * identified by the fixed `key: "INJ_USD"`. The controller always
 * upserts against that key instead of creating new rows per fetch.
 * ------------------------------------------------------------------
 */

import mongoose from "mongoose";

const priceHistorySchema = new mongoose.Schema(
  {
    timestamp: { type: Date, required: true },
    priceUsd: { type: Number, required: true },
  },
  { _id: false }
);

const marketDataSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "INJ_USD" },
    coinId: { type: String, required: true, default: "injective-protocol" },

    priceUsd: { type: Number, default: null },
    change24hPct: { type: Number, default: null },
    high24hUsd: { type: Number, default: null },
    low24hUsd: { type: Number, default: null },
    marketCapUsd: { type: Number, default: null },
    volume24hUsd: { type: Number, default: null },
    circulatingSupply: { type: Number, default: null },

    // Rolling window of price points used to render the 24h chart from
    // cache instead of re-hitting CoinGecko. Capped in the controller
    // (MAX_HISTORY_POINTS) so this array never grows unbounded.
    history: { type: [priceHistorySchema], default: [] },

    fetchedAt: { type: Date, default: Date.now },
    lastFetchError: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("MarketData", marketDataSchema);