/**
 * stats.controller.js
 * ------------------------------------------------------------------
 * Powers:
 *   GET /api/home/stats                 -> current snapshot, INJ only (Home.jsx)
 *   GET /api/dashboard/tokens           -> list of supported tokens (selector)
 *   GET /api/dashboard/stats?token=...  -> current snapshot for any supported token
 *   GET /api/dashboard/history?token=...-> time-series for the chart, any token
 *
 * Data sources:
 *   1. CoinGecko /coins/markets -> price, 24h change, market cap, rank,
 *      volume, circulating/total/max supply, ATH -- works for ANY
 *      CoinGecko-listed token, not just INJ.
 *   2. Injective LCD (public REST) -> total staked INJ (bonded pool).
 *      This is Injective-specific and only fetched when tokenId is
 *      "injective-protocol".
 *   3. Burned INJ -> still approximated as (max supply - circulating
 *      supply), same caveat as before. INJ-only.
 *
 * Caching strategy:
 *   One in-memory cache entry PER token, each with its own CACHE_TTL_MS
 *   window, so selecting a different token doesn't thrash the cache
 *   for the one everyone else is looking at.
 * ------------------------------------------------------------------
 */

import StatsSnapshot from "../models/Statssnapshot.model.js";

const COINGECKO_MARKETS_URL = "https://api.coingecko.com/api/v3/coins/markets";

// Public Injective LCD (REST) endpoint. Swap for your own node if you
// have one, or a load-balanced provider from
// https://docs.injective.network/infra/public-endpoints
const INJECTIVE_LCD_URL = "https://sentry.lcd.injective.network";

// Re-fetch live data for a given token at most once every 60s.
const CACHE_TTL_MS = 60 * 1000;

// Curated list of tokens the dashboard supports out of the box. Add
// or remove entries freely -- `id` must be the token's CoinGecko id
// (find it in the coin's CoinGecko URL, e.g. coingecko.com/en/coins/bitcoin).
export const SUPPORTED_TOKENS = [
  { id: "injective-protocol", symbol: "INJ", name: "Injective" },
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "solana", symbol: "SOL", name: "Solana" },
  { id: "binancecoin", symbol: "BNB", name: "BNB" },
  { id: "ripple", symbol: "XRP", name: "XRP" },
  { id: "cardano", symbol: "ADA", name: "Cardano" },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
  { id: "polkadot", symbol: "DOT", name: "Polkadot" },
  { id: "avalanche-2", symbol: "AVAX", name: "Avalanche" },
  { id: "chainlink", symbol: "LINK", name: "Chainlink" },
  { id: "cosmos", symbol: "ATOM", name: "Cosmos Hub" },
  { id: "the-open-network", symbol: "TON", name: "Toncoin" },
  { id: "tron", symbol: "TRX", name: "TRON" },
  { id: "matic-network", symbol: "MATIC", name: "Polygon" },
];

const DEFAULT_TOKEN_ID = "injective-protocol";

// Per-token in-memory cache: tokenId -> { data, fetchedAt }
const memoryCache = new Map();

function isSupportedToken(tokenId) {
  return SUPPORTED_TOKENS.some((t) => t.id === tokenId);
}

function getTokenMeta(tokenId) {
  return SUPPORTED_TOKENS.find((t) => t.id === tokenId) || null;
}

// ---------------- individual data source fetchers ----------------

// Works for any CoinGecko-listed token -- this single endpoint gives
// us price, change, market cap, rank, volume, supply and ATH in one call.
async function fetchCoingeckoMarketData(tokenId) {
  const url = `${COINGECKO_MARKETS_URL}?vs_currency=usd&ids=${tokenId}&price_change_percentage=24h`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko markets request failed: ${res.status}`);
  const json = await res.json();
  const entry = json[0];
  if (!entry) throw new Error(`CoinGecko response missing entry for "${tokenId}"`);

  return {
    priceUsd: entry.current_price ?? null,
    priceChange24h: entry.price_change_percentage_24h ?? null,
    marketCapUsd: entry.market_cap ?? null,
    marketCapRank: entry.market_cap_rank ?? null,
    volume24hUsd: entry.total_volume ?? null,
    circulatingSupply: entry.circulating_supply ?? null,
    totalSupply: entry.total_supply ?? null,
    maxSupply: entry.max_supply ?? null,
    athUsd: entry.ath ?? null,
    athChangePercent: entry.ath_change_percentage ?? null,
  };
}

// Cosmos SDK standard staking module endpoint. Injective-only -- there's
// no equivalent generic "staked amount" for arbitrary tokens.
async function fetchStakedInj() {
  const res = await fetch(`${INJECTIVE_LCD_URL}/cosmos/staking/v1beta1/pool`);
  if (!res.ok) throw new Error(`Injective LCD staking pool request failed: ${res.status}`);
  const json = await res.json();
  const bondedBaseUnits = json?.pool?.bonded_tokens;
  if (!bondedBaseUnits) return null;
  return Number(bondedBaseUnits) / 1e18;
}

// TODO: same caveat as before -- no single public REST endpoint gives
// "total INJ burned to date" directly. Approximated as
// (max supply - circulating supply). Swap for a real burn-auction
// indexer if/when you have one. INJ-only.
function estimateBurnedInj({ maxSupply, circulatingSupply }) {
  if (!maxSupply || !circulatingSupply) return null;
  const estimate = maxSupply - circulatingSupply;
  return estimate > 0 ? estimate : null;
}

// ---------------- combined fetch + persist ----------------

async function fetchLiveStats(tokenId) {
  const marketData = await fetchCoingeckoMarketData(tokenId);

  let totalStakedInj = null;
  let totalBurnedInj = null;

  if (tokenId === "injective-protocol") {
    totalStakedInj = await fetchStakedInj().catch((err) => {
      console.error("fetchStakedInj failed:", err.message);
      return null;
    });
    totalBurnedInj = estimateBurnedInj(marketData);
  }

  const tokenMeta = getTokenMeta(tokenId);

  return {
    tokenId,
    tokenSymbol: tokenMeta?.symbol ?? null,
    tokenName: tokenMeta?.name ?? null,
    ...marketData,
    totalStakedInj,
    totalBurnedInj,
  };
}

async function getFreshOrCachedStats(tokenId) {
  const cached = memoryCache.get(tokenId);
  const isStale = !cached || Date.now() - cached.fetchedAt > CACHE_TTL_MS;

  if (!isStale) {
    return cached.data;
  }

  const liveStats = await fetchLiveStats(tokenId);
  memoryCache.set(tokenId, { data: liveStats, fetchedAt: Date.now() });

  // Persist a snapshot for the history/chart endpoint. Fire-and-forget
  // (don't block the response on the DB write).
  StatsSnapshot.create({ ...liveStats, capturedAt: new Date() }).catch((err) => {
    console.error("Failed to save StatsSnapshot:", err.message);
  });

  return liveStats;
}

// ---------------- route handlers ----------------

// GET /api/dashboard/tokens
// Returns the list of tokens the selector can show. Static + free, no
// external call needed.
export async function getTokens(req, res) {
  return res.json({ success: true, tokens: SUPPORTED_TOKENS });
}

// GET /api/home/stats            (no ?token -> always INJ, unchanged behavior)
// GET /api/dashboard/stats?token=bitcoin
export async function getStats(req, res) {
  const tokenId = String(req.query.token || DEFAULT_TOKEN_ID);

  if (!isSupportedToken(tokenId)) {
    return res.status(400).json({
      success: false,
      message: `Unsupported token "${tokenId}". See GET /api/dashboard/tokens for the supported list.`,
    });
  }

  try {
    const stats = await getFreshOrCachedStats(tokenId);
    return res.json({ success: true, stats });
  } catch (err) {
    console.error("getStats error:", err);

    // Fall back to the last saved DB snapshot for this token if the
    // live fetch fails, so the frontend still has *something*.
    try {
      const last = await StatsSnapshot.findOne({ tokenId }).sort({ capturedAt: -1 }).lean();
      if (last) {
        return res.json({ success: true, stats: last, stale: true });
      }
    } catch (fallbackErr) {
      console.error("Fallback DB read also failed:", fallbackErr.message);
    }

    return res.status(502).json({ success: false, message: "Failed to load live stats" });
  }
}

// GET /api/dashboard/history?token=bitcoin&range=1h|24h|7d|30d&metric=priceUsd
// Returns an array of { t, v } points for charting, scoped to one token.
export async function getHistory(req, res) {
  try {
    const tokenId = String(req.query.token || DEFAULT_TOKEN_ID);
    const rangeParam = String(req.query.range || "24h").toLowerCase();
    const metric = String(req.query.metric || "priceUsd");

    if (!isSupportedToken(tokenId)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported token "${tokenId}". See GET /api/dashboard/tokens for the supported list.`,
      });
    }

    const allowedMetrics = [
      "priceUsd",
      "marketCapUsd",
      "volume24hUsd",
      "circulatingSupply",
      "totalStakedInj",
      "totalBurnedInj",
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

    const rows = await StatsSnapshot.find({ tokenId, capturedAt: { $gte: since } })
      .sort({ capturedAt: 1 })
      .select({ capturedAt: 1, [metric]: 1, _id: 0 })
      .lean();

    const points = rows
      .filter((r) => r[metric] !== null && r[metric] !== undefined)
      .map((r) => ({ t: r.capturedAt, v: r[metric] }));

    return res.json({ success: true, tokenId, range: rangeParam, metric, points });
  } catch (err) {
    console.error("getHistory error:", err);
    return res.status(500).json({ success: false, message: "Failed to load stats history" });
  }
}