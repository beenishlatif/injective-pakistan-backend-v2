/**
 * cache.util.js
 * ------------------------------------------------------------------
 * Tiny in-memory TTL cache. Keeps us from hammering CoinGecko / LCD /
 * DefiLlama / alternative.me on every request (those have rate limits
 * on free tiers). Good enough for a single Node process; if you scale
 * to multiple instances, swap this for Redis later.
 * ------------------------------------------------------------------
 */

const store = new Map();

/**
 * Get a cached value, or compute + cache it if missing/expired.
 * @param {string} key unique cache key
 * @param {number} ttlMs how long the value stays fresh
 * @param {() => Promise<any>} fn function that produces the value
 */
export async function cached(key, ttlMs, fn) {
  const hit = store.get(key);
  const now = Date.now();

  if (hit && now - hit.time < ttlMs) {
    return hit.value;
  }

  try {
    const value = await fn();
    store.set(key, { value, time: now });
    return value;
  } catch (err) {
    // If the fetch fails but we have a stale value, serve stale data
    // instead of breaking the dashboard.
    if (hit) {
      console.warn(`[cache] "${key}" fetch failed, serving stale value:`, err.message);
      return hit.value;
    }
    throw err;
  }
}

export function clearCache(key) {
  if (key) store.delete(key);
  else store.clear();
}