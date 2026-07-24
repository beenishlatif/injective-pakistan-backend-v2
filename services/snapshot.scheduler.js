/**
 * snapshot.scheduler.js
 * ------------------------------------------------------------------
 * Periodically pulls live stats and writes one StatsSnapshot document.
 * This is what populates the /history, /compare-adjacent table, and
 * CSV export features on the Markets tab — without stored snapshots
 * there would be no time series to chart.
 *
 * Start this once when the server boots (see the one-line addition
 * needed in server.js in the note below). Uses plain setInterval, so
 * no extra npm dependency (like node-cron) is required.
 * ------------------------------------------------------------------
 */

import StatsSnapshot from "../models/StatsSnapshot.js";
import { getInjMarketData } from "./coingecko.service.js";
import { getStakingInfo, computeNetSupplyChange } from "./injective.service.js";

const SNAPSHOT_INTERVAL_MS = (Number(process.env.SNAPSHOT_INTERVAL_MINUTES) || 15) * 60_000;

async function takeSnapshot() {
  try {
    const [market, staking] = await Promise.all([getInjMarketData(), getStakingInfo()]);

    await StatsSnapshot.create({
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
    });

    console.log(`[snapshot] saved at ${new Date().toISOString()}`);
  } catch (err) {
    console.error("[snapshot] failed to save snapshot:", err.message);
  }
}

let intervalHandle = null;

export function startSnapshotScheduler() {
  if (intervalHandle) return; // guard against double-start

  // Take one immediately on boot, then repeat on the interval.
  takeSnapshot();
  intervalHandle = setInterval(takeSnapshot, SNAPSHOT_INTERVAL_MS);
  console.log(
    `[snapshot] scheduler started — every ${SNAPSHOT_INTERVAL_MS / 60_000} minute(s)`
  );
}

export function stopSnapshotScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}