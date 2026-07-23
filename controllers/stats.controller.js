/**
 * stats.controller.js
 * ------------------------------------------------------------------
 * Powers the live INJ stats endpoint(s):
 *   - getLiveStats     -> price + staked + supply snapshot (cached, 45s TTL)
 *   - getPriceHistory  -> historical price points for the chart/table
 *
 * Live snapshots are cached in MongoDB (StatsSnapshot singleton doc) so
 * concurrent users don't each trigger fresh upstream calls, and so the
 * site keeps serving the last known-good data if a source is temporarily
 * down.
 * ------------------------------------------------------------------
 */

import { getInjPrice } from "../services/coingecko.service.js";
import { getStakedInj, getSupplyInfo } from "../services/injective.service.js";
import StatsSnapshot from "../models/Statssnapshot.model.js";

const SNAPSHOT_KEY = "INJ_STATS";

// How long a cached snapshot is considered fresh before we re-fetch from
// upstream sources. Keeps us well under provider rate limits even with
// many concurrent dashboard viewers.
const CACHE_TTL_MS = 45 * 1000;

// If a snapshot is more than 3x the TTL old (a source unreachable for a
// while), the frontend gets a `stale: true` flag so it can show a subtle
// "delayed" indicator instead of pretending the data is fresh.
const STALE_AFTER_MS = CACHE_TTL_MS * 3;

// Cap on stored history points, so the document doesn't grow forever.
const MAX_HISTORY_POINTS = 1000;

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const COIN_ID = "injective-protocol";
const RANGE_TO_DAYS = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`CoinGecko request failed (${res.status})`);
  return res.json();
}

// Pulls a fresh snapshot from your existing services, upserts it into the
// singleton StatsSnapshot doc, and appends one point to the rolling
// history array.
async function refreshLiveSnapshot() {
  const [priceData, stakedData, supplyData] = await Promise.allSettled([
    getInjPrice(),
    getStakedInj(),
    getSupplyInfo(),
  ]);

  const priceUsd = priceData.status === "fulfilled" ? priceData.value : null;
  const staked = stakedData.status === "fulfilled" ? stakedData.value.staked : null;
  const totalSupply =
    supplyData.status === "fulfilled" ? supplyData.value.totalSupply : null;

  const fetchedAt = new Date();
  const firstError = [priceData, stakedData, supplyData].find(
    (r) => r.status === "rejected"
  );

  return StatsSnapshot.findOneAndUpdate(
    { key: SNAPSHOT_KEY },
    {
      $set: {
        priceUsd,
        staked,
        totalSupply,
        fetchedAt,
        lastFetchError: firstError ? firstError.reason?.message ?? "Unknown error" : null,
      },
      $push: priceUsd
        ? {
            history: {
              $each: [{ timestamp: fetchedAt, priceUsd }],
              $slice: -MAX_HISTORY_POINTS,
            },
          }
        : undefined,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

// GET /api/stats  (live stats, cached)
export const getLiveStats = async (req, res) => {
  try {
    let doc = await StatsSnapshot.findOne({ key: SNAPSHOT_KEY });
    const isCacheStale =
      !doc || Date.now() - new Date(doc.fetchedAt).getTime() > CACHE_TTL_MS;

    if (isCacheStale) {
      try {
        doc = await refreshLiveSnapshot();
      } catch (fetchErr) {
        console.error("Live stats refresh failed:", fetchErr.message);
        if (doc) {
          // Keep serving the last known-good snapshot instead of erroring.
          await StatsSnapshot.updateOne(
            { key: SNAPSHOT_KEY },
            { $set: { lastFetchError: fetchErr.message } }
          );
        } else {
          return res.status(502).json({
            success: false,
            message: "Unable to reach data providers and no cached data is available yet.",
          });
        }
      }
    }

    return res.json({
      success: true,
      stale: Date.now() - new Date(doc.fetchedAt).getTime() > STALE_AFTER_MS,
      price: doc.priceUsd,
      staked: doc.staked,
      totalSupply: doc.totalSupply,
      updatedAt: doc.fetchedAt,
    });
  } catch (err) {
    console.error("getLiveStats error:", err);
    res.status(500).json({ error: "Failed to fetch live stats" });
  }
};

// GET /api/stats/history?range=24h|7d|30d|90d
export const getPriceHistory = async (req, res) => {
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
    // spans enough points, saving an extra external round trip on the
    // most commonly viewed range.
    if (range === "24h") {
      const doc = await StatsSnapshot.findOne({ key: SNAPSHOT_KEY });
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
};