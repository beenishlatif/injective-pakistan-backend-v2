/**
 * stats.controller.js
 * ------------------------------------------------------------------
 * Powers both:
 *   GET /api/home/stats            -> single "current" snapshot (Home.jsx)
 *   GET /api/dashboard/stats       -> single "current" snapshot (Dashboard.jsx)
 *   GET /api/dashboard/history     -> time-series for the chart (Dashboard.jsx)
 *
 * Data sources:
 *   1. CoinGecko  -> live USD price, 24h change, market cap, circulating supply
 *   2. Injective LCD (public REST) -> total staked INJ (bonded pool)
 *   3. Helix / burn numbers        -> see the TODO comments below; these
 *      aren't exposed on one simple public endpoint, so they either need
 *      to come from Helix's own API, an indexer you run, or be filled in
 *      manually until you wire up a real source.
 *
 * Caching strategy:
 *   We don't hit CoinGecko/LCD on every single request (rate limits +
 *   latency). Instead we keep an in-memory cache for CACHE_TTL_MS, and
 *   only fetch fresh + save a new DB snapshot when the cache is stale.
 * ------------------------------------------------------------------
 */

const StatsSnapshot = require("../models/StatsSnapshot.model");

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=injective-protocol&vs_currencies=usd&include_24hr_change=true&include_market_cap=true";

const COINGECKO_COIN_URL =
  "https://api.coingecko.com/api/v3/coins/injective-protocol?localization=false&tickers=false&community_data=false&developer_data=false";

// Public Injective LCD (REST) endpoint. Swap for your own node if you
// have one, or a load-balanced provider from
// https://docs.injective.network/infra/public-endpoints
const INJECTIVE_LCD_URL = "https://sentry.lcd.injective.network";

// Re-fetch live data at most once every 60s; everyone hitting the API
// inside that window gets the same cached snapshot.
const CACHE_TTL_MS = 60 * 1000;

let memoryCache = {
  data: null,
  fetchedAt: 0,
};

// ---------------- individual data source fetchers ----------------

async function fetchCoingeckoPrice() {
  const res = await fetch(COINGECKO_URL);
  if (!res.ok) throw new Error(`CoinGecko price request failed: ${res.status}`);
  const json = await res.json();
  const entry = json["injective-protocol"];
  if (!entry) throw new Error("CoinGecko response missing injective-protocol entry");
  return {
    injPriceUsd: entry.usd ?? null,
    injPriceChange24h: entry.usd_24h_change ?? null,
    marketCapUsd: entry.usd_market_cap ?? null,
  };
}

async function fetchCoingeckoSupply() {
  const res = await fetch(COINGECKO_COIN_URL);
  if (!res.ok) throw new Error(`CoinGecko coin request failed: ${res.status}`);
  const json = await res.json();
  const md = json.market_data || {};
  return {
    circulatingSupply: md.circulating_supply ?? null,
    maxSupply: md.max_supply ?? null,
    totalVolumeUsd: md.total_volume?.usd ?? null,
  };
}

// Cosmos SDK standard staking module endpoint — works on every
// Cosmos chain, Injective included. Returns bonded_tokens in base
// units (1 INJ = 1e18 base units on Injective).
async function fetchStakedInj() {
  const res = await fetch(`${INJECTIVE_LCD_URL}/cosmos/staking/v1beta1/pool`);
  if (!res.ok) throw new Error(`Injective LCD staking pool request failed: ${res.status}`);
  const json = await res.json();
  const bondedBaseUnits = json?.pool?.bonded_tokens;
  if (!bondedBaseUnits) return null;
  return Number(bondedBaseUnits) / 1e18;
}

// TODO: There is no single public REST endpoint that gives you
// "total INJ burned to date" directly — Injective burns INJ weekly
// through the Helix/exchange buy-back auction. Two practical options:
//   1. Point this at your own indexer / the burn-auction API once you
//      have one, and just return that number.
//   2. Approximate it as (max supply - circulating supply), since INJ
//      has a deflationary/no-fixed-cap model driven by burns. This is
//      an approximation, not an exact on-chain "burned" counter.
function estimateBurnedInj({ maxSupply, circulatingSupply }) {
  if (!maxSupply || !circulatingSupply) return null;
  const estimate = maxSupply - circulatingSupply;
  return estimate > 0 ? estimate : null;
}

// TODO: Helix's own public API/docs will have a real 24h volume
// endpoint for their order books. Wire that in here. Until then we
// fall back to CoinGecko's exchange-wide 24h volume as a stand-in so
// the UI isn't empty.
function fallbackHelixVolume(totalVolumeUsd) {
  return totalVolumeUsd ?? null;
}

// ---------------- combined fetch + persist ----------------

async function fetchLiveStats() {
  const [priceData, supplyData, totalStakedInj] = await Promise.all([
    fetchCoingeckoPrice(),
    fetchCoingeckoSupply(),
    fetchStakedInj().catch((err) => {
      console.error("fetchStakedInj failed:", err.message);
      return null;
    }),
  ]);

  const totalBurnedInj = estimateBurnedInj(supplyData);
  const helixVolume24hUsd = fallbackHelixVolume(supplyData.totalVolumeUsd);

  return {
    injPriceUsd: priceData.injPriceUsd,
    injPriceChange24h: priceData.injPriceChange24h,
    marketCapUsd: priceData.marketCapUsd,
    circulatingSupply: supplyData.circulatingSupply,
    totalStakedInj,
    totalBurnedInj,
    helixVolume24hUsd,
  };
}

async function getFreshOrCachedStats() {
  const isStale = Date.now() - memoryCache.fetchedAt > CACHE_TTL_MS;
  if (!isStale && memoryCache.data) {
    return memoryCache.data;
  }

  const liveStats = await fetchLiveStats();

  memoryCache = { data: liveStats, fetchedAt: Date.now() };

  // Persist a snapshot for the history/chart endpoint. Fire-and-forget
  // (don't block the response on the DB write).
  StatsSnapshot.create({ ...liveStats, capturedAt: new Date() }).catch((err) => {
    console.error("Failed to save StatsSnapshot:", err.message);
  });

  return liveStats;
}

// ---------------- route handlers ----------------

// GET /api/home/stats  and  GET /api/dashboard/stats
// Returns the current/latest stats snapshot.
async function getStats(req, res) {
  try {
    const stats = await getFreshOrCachedStats();
    return res.json({ success: true, stats });
  } catch (err) {
    console.error("getStats error:", err);

    // Fall back to the last saved DB snapshot if the live fetch fails,
    // so the frontend still has *something* instead of a hard error.
    try {
      const last = await StatsSnapshot.findOne().sort({ capturedAt: -1 }).lean();
      if (last) {
        return res.json({ success: true, stats: last, stale: true });
      }
    } catch (fallbackErr) {
      console.error("Fallback DB read also failed:", fallbackErr.message);
    }

    return res.status(502).json({ success: false, message: "Failed to load live stats" });
  }
}

// GET /api/dashboard/history?range=1h|24h|7d|30d&metric=injPriceUsd
// Returns an array of { capturedAt, value } points for charting.
async function getHistory(req, res) {
  try {
    const rangeParam = String(req.query.range || "24h").toLowerCase();
    const metric = String(req.query.metric || "injPriceUsd");

    const allowedMetrics = [
      "injPriceUsd",
      "totalStakedInj",
      "totalBurnedInj",
      "helixVolume24hUsd",
      "marketCapUsd",
    ];
    if (!allowedMetrics.includes(metric)) {
      return res.status(400).json({
        success: false,
        message: `Invalid metric. Must be one of: ${allowedMetrics.join(", ")}`,
      });
    }

    const rangeToMs = {
      "1h": 60 * 60 * 1000,
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
    };
    const windowMs = rangeToMs[rangeParam] ?? rangeToMs["24h"];
    const since = new Date(Date.now() - windowMs);

    const rows = await StatsSnapshot.find({ capturedAt: { $gte: since } })
      .sort({ capturedAt: 1 })
      .select({ capturedAt: 1, [metric]: 1, _id: 0 })
      .lean();

    const points = rows
      .filter((r) => r[metric] !== null && r[metric] !== undefined)
      .map((r) => ({ t: r.capturedAt, v: r[metric] }));

    return res.json({ success: true, range: rangeParam, metric, points });
  } catch (err) {
    console.error("getHistory error:", err);
    return res.status(500).json({ success: false, message: "Failed to load stats history" });
  }
}

module.exports = {
  getStats,
  getHistory,
};