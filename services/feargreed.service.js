/**
 * feargreed.service.js
 * ------------------------------------------------------------------
 * Broad crypto market Fear & Greed Index (not INJ-specific — matches
 * the label already used in Dashboard.jsx's FearGreedMeter panel).
 * Source: alternative.me, free, no API key needed.
 * ------------------------------------------------------------------
 */

import { cached } from "./cache.util.js";

export async function getFearGreedIndex() {
  return cached("feargreed:index", 15 * 60_000, async () => {
    const res = await fetch("https://api.alternative.me/fng/?limit=1");
    if (!res.ok) throw new Error(`Fear & Greed request failed (${res.status})`);
    const data = await res.json();
    const entry = data?.data?.[0];
    if (!entry) return null;

    return {
      value: Number(entry.value),
      label: entry.value_classification,
    };
  });
}