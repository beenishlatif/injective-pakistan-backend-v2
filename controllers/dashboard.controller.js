/**
 * dashboard.controller.js
 * ------------------------------------------------------------------
 * Powers the live INJ dashboard:
 *   - getLiveStats  -> current price + market snapshot (cached, 45s TTL)
 *   - getPriceHistory -> historical price points for the chart/table
 *
 * Data source: CoinGecko public API (no key required). Live snapshots
 * are cached in MongoDB (MarketData singleton doc) so concurrent users
 * don't each trigger a fresh CoinGecko call, and so the dashboard keeps
 * serving the last known-good data if CoinGecko is temporarily down.
 * ------------------------------------------------------------------
 */

import MarketData from "../models/marketData.model.js";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const COIN_ID = "injective-protocol";
const SNAPSHOT_KEY = "INJ_USD";

// How long a cached snapshot is considered fresh before we re-fetch from
// CoinGecko. Keeps us well under their public rate limit even with many
// concurrent dashboard viewers.
const CACHE_TTL_MS = 45 * 1000;

// If a snapshot is more than 3x the TTL old (CoinGecko unreachable for a
// while), the frontend gets a `stale: true` flag so it can show a subtle
// "delayed" indicator instead of pretending the data is fresh.
const STALE_AFTER_MS = CACHE_TTL_MS * 3;

// Cap on stored history points, so the document doesn't grow forever.
// One point per fetch cycle (~45s) is more than enough for a smooth
// 24h chart from cache.
const MAX_HISTORY_POINTS = 1000;

const RANGE_TO_DAYS = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`CoinGecko request failed (${res.status})`);
  return res.json();
}

// Pulls a fresh snapshot from CoinGecko, upserts it into the singleton
// MarketData doc, and appends one point to the rolling history array.
async function refreshLiveSnapshot() {
  const url = `${COINGECKO_BASE}/coins/${COIN_ID}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
  const data = await fetchJson(url);
  const md = data.market_data || {};
  const fetchedAt = new Date();

  const snapshot = {
    priceUsd: md.current_price?.usd ?? null,
    change24hPct: md.price_change_percentage_24h ?? null,
    high24hUsd: md.high_24h?.usd ?? null,
    low24hUsd: md.low_24h?.usd ?? null,
    marketCapUsd: md.market_cap?.usd ?? null,
    volume24hUsd: md.total_volume?.usd ?? null,
    circulatingSupply: md.circulating_supply ?? null,
    fetchedAt,
    lastFetchError: null,
  };

  return MarketData.findOneAndUpdate(
    { key: SNAPSHOT_KEY },
    {
      $set: { coinId: COIN_ID, ...snapshot },
      $push: {
        history: {
          $each: [{ timestamp: fetchedAt, priceUsd: snapshot.priceUsd }],
          $slice: -MAX_HISTORY_POINTS,
        },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

// GET /api/dashboard/live
export async function getLiveStats(req, res) {
  try {
    let doc = await MarketData.findOne({ key: SNAPSHOT_KEY });
    const isCacheStale = !doc || Date.now() - new Date(doc.fetchedAt).getTime() > CACHE_TTL_MS;

    if (isCacheStale) {
      try {
        doc = await refreshLiveSnapshot();
      } catch (fetchErr) {
        console.error("CoinGecko live fetch failed:", fetchErr.message);
        if (doc) {
          // Keep serving the last known-good snapshot instead of erroring.
          await MarketData.updateOne(
            { key: SNAPSHOT_KEY },
            { $set: { lastFetchError: fetchErr.message } }
          );
        } else {
          return res.status(502).json({
            success: false,
            message: "Unable to reach price provider and no cached data is available yet.",
          });
        }
      }
    }

    return res.json({
      success: true,
      stale: Date.now() - new Date(doc.fetchedAt).getTime() > STALE_AFTER_MS,
      stats: {
        priceUsd: doc.priceUsd,
        change24hPct: doc.change24hPct,
        high24hUsd: doc.high24hUsd,
        low24hUsd: doc.low24hUsd,
        marketCapUsd: doc.marketCapUsd,
        volume24hUsd: doc.volume24hUsd,
        circulatingSupply: doc.circulatingSupply,
        fetchedAt: doc.fetchedAt,
      },
    });
  } catch (err) {
    console.error("getLiveStats error:", err);
    return res.status(500).json({ success: false, message: "Server error fetching live stats." });
  }
}

// GET /api/dashboard/history?range=24h|7d|30d|90d
export async function getPriceHistory(req, res) {
  const range = String(req.query.range || "24h").toLowerCase();
  const days = RANGE_TO_DAYS[range];

  if (!days) {
    return res.status(400).json({
      success: false,
      message: "Invalid range. Use one of: 24h, 7d, 30d, 90d.",
    });
  }

  try {
    // Shortest range: prefer our own cached history when it already
    // spans enough points, saving an extra CoinGecko round trip on the
    // most commonly viewed range.
    if (range === "24h") {
      const doc = await MarketData.findOne({ key: SNAPSHOT_KEY });
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const cached = (doc?.history || []).filter(
        (p) => new Date(p.timestamp).getTime() >= cutoff
      );
      if (cached.length >= 20) {
        return res.json({
          success: true,
          range,
          source: "cache",
          points: cached.map((p) => ({ timestamp: p.timestamp, priceUsd: p.priceUsd })),
        });
      }
    }

    const url = `${COINGECKO_BASE}/coins/${COIN_ID}/market_chart?vs_currency=usd&days=${days}`;
    const data = await fetchJson(url);
    const points = (data.prices || []).map(([ts, price]) => ({
      timestamp: new Date(ts),
      priceUsd: price,
    }));

    return res.json({ success: true, range, source: "coingecko", points });
  } catch (err) {
    console.error("getPriceHistory error:", err);
    return res.status(502).json({
      success: false,
      message: "Unable to load price history right now. Please try again shortly.",
    });
  }
}