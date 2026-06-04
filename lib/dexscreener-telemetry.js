/**
 * Telemetria leve DexScreener (duração por fetch de par), em memória desde o arranque.
 * Não expõe URLs nem dados sensíveis — só marketId e estatísticas agregadas.
 *
 * Env: DEXSCREENER_TELEMETRY=0 desliga gravação (default ligado).
 */

"use strict";

/** @type {Map<string, { sumMs: number, n: number, errN: number }>} */
const byMarket = new Map();

function telemetryEnabled() {
  return process.env.DEXSCREENER_TELEMETRY !== "0";
}

/**
 * @param {string | undefined} marketId
 * @param {number} elapsedMs
 * @param {boolean} ok
 */
function recordDexscreenerPairFetch(marketId, elapsedMs, ok) {
  if (!telemetryEnabled() || !marketId) return;
  const id = String(marketId);
  const cur = byMarket.get(id) || { sumMs: 0, n: 0, errN: 0 };
  if (ok) {
    cur.sumMs += Math.max(0, elapsedMs);
    cur.n += 1;
  } else {
    cur.errN += 1;
  }
  byMarket.set(id, cur);
}

/**
 * @param {{ limit?: number }} [opts]
 */
function getDexscreenerTelemetrySummary(opts = {}) {
  const limit = Math.min(40, Math.max(5, parseInt(String(opts.limit || "15"), 10) || 15));
  let totalN = 0;
  let totalErr = 0;
  let sumAllMs = 0;
  const rows = [];
  for (const [marketId, v] of byMarket) {
    totalN += v.n;
    totalErr += v.errN;
    sumAllMs += v.sumMs;
    if (v.n > 0) {
      rows.push({
        marketId,
        avgMs: Math.round(v.sumMs / v.n),
        samples: v.n,
        errors: v.errN
      });
    }
  }
  rows.sort((a, b) => b.avgMs - a.avgMs);
  const slowestMarkets = rows.slice(0, limit);
  const chronicFailures = [...byMarket.entries()]
    .filter(([, v]) => v.errN >= 5 && v.n <= 2)
    .map(([marketId, v]) => ({ marketId, errors: v.errN, successes: v.n }))
    .sort((a, b) => b.errors - a.errors)
    .slice(0, limit);
  return {
    enabled: telemetryEnabled(),
    marketsTracked: byMarket.size,
    totalPairFetchesOk: totalN,
    totalPairFetchErrors: totalErr,
    meanMsAllMarkets:
      totalN > 0 ? Math.round(sumAllMs / totalN) : null,
    slowestMarkets,
    marketsDexOnlyErrors: chronicFailures
  };
}

function resetDexscreenerTelemetryForTests() {
  byMarket.clear();
}

module.exports = {
  recordDexscreenerPairFetch,
  getDexscreenerTelemetrySummary,
  resetDexscreenerTelemetryForTests
};
