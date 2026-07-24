/**
 * coingecko.service.js
 * ------------------------------------------------------------------
 * All CoinGecko-backed data:
 *   - Live INJ price (USD / PKR / EUR / GBP), market cap, supply, 24h
 *     high/low, 24h change, and total exchange volume (used as the
 *     "Helix 24H Volume" approximation — CoinGecko doesn't expose
 *     Helix-only volume, so this is INJ's total volume across all
 *     exchanges CoinGecko tracks. Swap this for Injective's own
 *     indexer/exchange API later if you need Helix-specific volume).
 *   - Historical market-chart series for INJ / BTC / ETH / SOL / ATOM
 *     / BNB, used by the /compare endpoint.
 *
 * Free CoinGecko API — no key required, but rate-limited, so every
 * call here goes through the shared cache.
 * ------------------------------------------------------------------
 */

import { cached } from "./cache.util.js";

const CG_BASE = "https://api.coingecko.com/api/v3";
const INJ_ID = "injective-protocol";

export const COIN_IDS = {
  inj: "injective-protocol",
  btc: "bitcoin",
  eth: "ethereum",
  sol: "solana",
  atom: "cosmos",
  bnb: "binancecoin",
};

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`CoinGecko request failed (${res.status}): ${url}`);
  }
  return res.json();
}

/**
 * Live market snapshot for INJ.
 * Cached for 60s so a burst of dashboard loads only hits CoinGecko once.
 */
export async function getInjMarketData() {
  return cached("cg:inj-market-data", 60_000, async () => {
    const url = `${CG_BASE}/coins/${INJ_ID}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
    const data = await fetchJson(url);
    const md = data.market_data || {};

    return {
      injPriceUsd: md.current_price?.usd ?? null,
      injPricePkr: md.current_price?.pkr ?? null,
      injPriceEur: md.current_price?.eur ?? null,
      injPriceGbp: md.current_price?.gbp ?? null,
      injPriceChange24h: md.price_change_percentage_24h ?? null,
      high24hUsd: md.high_24h?.usd ?? null,
      low24hUsd: md.low_24h?.usd ?? null,
      marketCapUsd: md.market_cap?.usd ?? null,
      circulatingSupply: md.circulating_supply ?? null,
      totalSupply: md.total_supply ?? null,
      helixVolume24hUsd: md.total_volume?.usd ?? null,
    };
  });
}

/**
 * Historical price series for a single asset, used to build the
 * % change comparison chart.
 * @param {"inj"|"btc"|"eth"|"sol"|"atom"|"bnb"} assetKey
 * @param {"1h"|"24h"|"7d"|"30d"|"90d"|"1y"|"max"} range
 * @returns {Promise<Array<{ time: number, price: number }>>}
 */
export async function getMarketChart(assetKey, range) {
  const coinId = COIN_IDS[assetKey];
  if (!coinId) throw new Error(`Unknown asset key: ${assetKey}`);

  const days = rangeToDays(range);
  const cacheKey = `cg:chart:${coinId}:${days}`;

  return cached(cacheKey, 5 * 60_000, async () => {
    const url = `${CG_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;
    const data = await fetchJson(url);
    const prices = data.prices || []; // [[timestampMs, price], ...]
    return prices.map(([time, price]) => ({ time, price }));
  });
}

function rangeToDays(range) {
  switch (range) {
    case "1h":
      return 1; // CoinGecko's minimum granularity is ~5min data for 1 day
    case "24h":
      return 1;
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
    case "1y":
      return 365;
    case "max":
      return "max";
    default:
      return 1;
  }
}