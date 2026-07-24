/**
 * stats.controller.js
 * ------------------------------------------------------------------
 * Request handlers for every endpoint Dashboard.jsx calls:
 *   GET /live        -> getLiveStats
 *   GET /history     -> getHistory
 *   GET /compare     -> getCompare
 *   GET /network     -> getNetworkStatus
 *   GET /validators  -> getValidators
 *   GET /governance  -> getGovernance
 *   GET /feargreed   -> getFearGreed
 *   GET /ecosystem   -> getEcosystem
 *   GET /summary     -> getSummary
 *
 * Every handler follows the same { success, ... } shape the frontend
 * already expects, and never throws an unhandled 500 for an external
 * API hiccup — it responds with success:false and a message instead
 * so the dashboard can show its own "couldn't refresh" / retry UI.
 * ------------------------------------------------------------------
 */

import StatsSnapshot from "../models/Statssnapshot.js";
import { getInjMarketData, getMarketChart } from "../services/coingecko.service.js";
import {
  getStakingInfo,
  computeNetSupplyChange,
  getNetworkStatus as fetchNetworkStatus,
  getValidatorsSummary,
  getLatestGovernanceProposal,
} from "../services/injective.service.js";
import { getFearGreedIndex } from "../services/feargreed.service.js";
import { getInjectiveEcosystemTvl } from "../services/ecosystem.service.js";
import { buildDashboardSummary } from "../services/summary.service.js";

const VALID_RANGES = ["1h", "24h", "7d", "30d", "90d", "1y", "max"];
const VALID_ASSETS = ["inj", "btc", "eth", "sol", "atom", "bnb"];

function rangeToSince(range) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  switch (range) {
    case "1h":
      return now - 60 * 60 * 1000;
    case "24h":
      return now - day;
    case "7d":
      return now - 7 * day;
    case "30d":
      return now - 30 * day;
    case "90d":
      return now - 90 * day;
    case "1y":
      return now - 365 * day;
    case "max":
    default:
      return 0;
  }
}

// ---------------------------------------------------------------
// GET /live
// ---------------------------------------------------------------
export async function getLiveStats(req, res) {
  try {
    const [market, staking] = await Promise.all([getInjMarketData(), getStakingInfo()]);

    const stats = {
      injPriceUsd: market.injPriceUsd,
      injPricePkr: market.injPricePkr,
      injPriceEur: market.injPriceEur,
      injPriceGbp: market.injPriceGbp,
      injPriceChange24h: market.injPriceChange24h,
      high24hUsd: market.high24hUsd,
      low24hUsd: market.low24hUsd,
      marketCapUsd: market.marketCapUsd,
      circulatingSupply: market.circulatingSupply,
      totalSupply: market.totalSupply,
      netSupplyChangeInj: computeNetSupplyChange(market.totalSupply),
      totalStakedInj: staking.totalStakedInj,
      stakingAprPercent: staking.stakingAprPercent,
      helixVolume24hUsd: market.helixVolume24hUsd,
    };

    return res.json({ success: true, stats });
  } catch (err) {
    console.error("getLiveStats error:", err.message);
    return res.status(502).json({ success: false, message: "Failed to fetch live stats" });
  }
}

// ---------------------------------------------------------------
// GET /history?range=1h|24h|7d|30d|90d|1y|max
// ---------------------------------------------------------------
export async function getHistory(req, res) {
  try {
    const range = VALID_RANGES.includes(req.query.range) ? req.query.range : "24h";
    const since = rangeToSince(range);

    const query = since ? { createdAt: { $gte: new Date(since) } } : {};
    const snapshots = await StatsSnapshot.find(query).sort({ createdAt: 1 }).lean();

    return res.json({ success: true, range, snapshots });
  } catch (err) {
    console.error("getHistory error:", err.message);
    return res.status(502).json({ success: false, message: "Failed to fetch history" });
  }
}

// ---------------------------------------------------------------
// GET /compare?range=...&assets=btc,eth,sol,atom,bnb
// ---------------------------------------------------------------
export async function getCompare(req, res) {
  try {
    const range = VALID_RANGES.includes(req.query.range) ? req.query.range : "24h";
    const requestedAssets = String(req.query.assets || "")
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter((a) => VALID_ASSETS.includes(a));

    const assets = requestedAssets.length ? requestedAssets : ["btc", "eth", "sol", "atom", "bnb"];

    const results = await Promise.all(
      assets.map(async (assetKey) => {
        const points = await getMarketChart(assetKey, range);
        if (!points.length) return [assetKey, []];

        const basePrice = points[0].price;
        const series = points.map((p) => ({
          time: p.time,
          pctChange: basePrice ? ((p.price - basePrice) / basePrice) * 100 : 0,
        }));
        return [assetKey, series];
      })
    );

    const series = Object.fromEntries(results);
    return res.json({ success: true, range, series });
  } catch (err) {
    console.error("getCompare error:", err.message);
    return res.status(502).json({ success: false, message: "Failed to fetch comparison data" });
  }
}

// ---------------------------------------------------------------
// GET /network
// ---------------------------------------------------------------
export async function getNetworkStatus(req, res) {
  try {
    const status = await fetchNetworkStatus();
    return res.json({ success: true, status });
  } catch (err) {
    console.error("getNetworkStatus error:", err.message);
    return res.status(502).json({ success: false, message: "Failed to fetch network status" });
  }
}

// ---------------------------------------------------------------
// GET /validators
// ---------------------------------------------------------------
export async function getValidators(req, res) {
  try {
    const validators = await getValidatorsSummary();
    return res.json({ success: true, validators });
  } catch (err) {
    console.error("getValidators error:", err.message);
    return res.status(502).json({ success: false, message: "Failed to fetch validators" });
  }
}

// ---------------------------------------------------------------
// GET /governance
// ---------------------------------------------------------------
export async function getGovernance(req, res) {
  try {
    const proposal = await getLatestGovernanceProposal();
    return res.json({ success: true, proposal });
  } catch (err) {
    console.error("getGovernance error:", err.message);
    return res.status(502).json({ success: false, message: "Failed to fetch governance data" });
  }
}

// ---------------------------------------------------------------
// GET /feargreed
// ---------------------------------------------------------------
export async function getFearGreed(req, res) {
  try {
    const index = await getFearGreedIndex();
    return res.json({ success: true, index });
  } catch (err) {
    console.error("getFearGreed error:", err.message);
    return res.status(502).json({ success: false, message: "Failed to fetch fear & greed index" });
  }
}

// ---------------------------------------------------------------
// GET /ecosystem
// ---------------------------------------------------------------
export async function getEcosystem(req, res) {
  try {
    const protocols = await getInjectiveEcosystemTvl();
    return res.json({ success: true, protocols });
  } catch (err) {
    console.error("getEcosystem error:", err.message);
    return res.status(502).json({ success: false, message: "Failed to fetch ecosystem data" });
  }
}

// ---------------------------------------------------------------
// GET /summary
// ---------------------------------------------------------------
export async function getSummary(req, res) {
  try {
    const [market, fearGreed, staking] = await Promise.all([
      getInjMarketData(),
      getFearGreedIndex().catch(() => null),
      getStakingInfo().catch(() => ({})),
    ]);

    const summary = buildDashboardSummary({ ...market, ...staking }, fearGreed);
    return res.json({ success: true, summary });
  } catch (err) {
    console.error("getSummary error:", err.message);
    return res.status(502).json({ success: false, message: "Failed to generate summary" });
  }
}