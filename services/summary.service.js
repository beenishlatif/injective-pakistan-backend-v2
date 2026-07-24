/**
 * summary.service.js
 * ------------------------------------------------------------------
 * Builds the short "TODAY'S SUMMARY" paragraph shown on the Overview
 * tab. This is a deterministic template (no external AI call, so it's
 * fast, free, and never fails) built from the live stats + fear/greed
 * data you already fetched elsewhere.
 *
 * If you'd rather generate this with an LLM, you already have
 * ai.routes.js in this project — just swap the body of
 * buildDashboardSummary() for a call into that service instead.
 * ------------------------------------------------------------------
 */

export function buildDashboardSummary(stats, fearGreed) {
  if (!stats || stats.injPriceUsd == null) {
    return "Live market data is loading — check back in a moment.";
  }

  const direction = stats.injPriceChange24h >= 0 ? "up" : "down";
  const changeAbs = Math.abs(stats.injPriceChange24h ?? 0).toFixed(2);

  const priceLine = `INJ is trading at $${stats.injPriceUsd.toFixed(2)}, ${direction} ${changeAbs}% over the last 24 hours.`;

  const rangeLine =
    stats.high24hUsd != null && stats.low24hUsd != null
      ? ` It has ranged between $${stats.low24hUsd.toFixed(2)} and $${stats.high24hUsd.toFixed(2)} today.`
      : "";

  const stakingLine =
    stats.stakingAprPercent != null
      ? ` Staking currently yields around ${stats.stakingAprPercent.toFixed(2)}% APR, with ${formatInjShort(
          stats.totalStakedInj
        )} INJ bonded to validators.`
      : "";

  const volumeLine =
    stats.helixVolume24hUsd != null
      ? ` Reported 24H trading volume stands at ${formatUsdShort(stats.helixVolume24hUsd)}.`
      : "";

  const sentimentLine = fearGreed?.label
    ? ` Broader crypto market sentiment reads "${fearGreed.label}" (${fearGreed.value}/100) on the Fear & Greed Index.`
    : "";

  return `${priceLine}${rangeLine}${stakingLine}${volumeLine}${sentimentLine}`.trim();
}

function formatUsdShort(value) {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function formatInjShort(value) {
  if (value == null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(2);
}