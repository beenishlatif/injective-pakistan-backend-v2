/**
 * ecosystem.service.js
 * ------------------------------------------------------------------
 * Top Injective ecosystem protocols by TVL, sourced from DefiLlama's
 * free public API (no key required).
 * ------------------------------------------------------------------
 */

import { cached } from "./cache.util.js";

const TOP_N = 6;

export async function getInjectiveEcosystemTvl() {
  return cached("ecosystem:injective-tvl", 30 * 60_000, async () => {
    const res = await fetch("https://api.llama.fi/protocols");
    if (!res.ok) throw new Error(`DefiLlama request failed (${res.status})`);
    const protocols = await res.json();

    const onInjective = protocols
      .filter((p) => p.chainTvls && Object.prototype.hasOwnProperty.call(p.chainTvls, "Injective"))
      .map((p) => ({
        key: p.slug,
        label: p.name,
        tvlUsd: p.chainTvls.Injective ?? null,
      }))
      .filter((p) => p.tvlUsd != null)
      .sort((a, b) => b.tvlUsd - a.tvlUsd)
      .slice(0, TOP_N);

    return onInjective;
  });
}