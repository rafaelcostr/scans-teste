/**
 * Volatilidade do spread (e amplitude) no histórico JSONL por mercado.
 *
 * Env:
 *   HISTORY_VOLATILITY_WINDOW_SCANS (default 30, max 200)
 *   HISTORY_VOLATILITY_MIN_POINTS (default 5)
 *   HISTORY_VOLATILITY_STDDEV_SPREAD_MIN — σ mínimo em % para avisar (default 0.12)
 *   HISTORY_VOLATILITY_RANGE_SPREAD_MIN — max−min mínimo em % para avisar (default 0.35)
 *   HISTORY_VOLATILITY_ONLY_DYNAMIC — 1 = só dyn-* (default 1)
 */

const { readRecentScanLines } = require("./scan-history");

function truthyDynamicOnly() {
  const e = process.env.HISTORY_VOLATILITY_ONLY_DYNAMIC;
  if (e === "0" || e === "false") return false;
  return true;
}

function sampleStdevPct(values) {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const v =
    values.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (n - 1);
  return Math.sqrt(Math.max(0, v));
}

/**
 * @returns {Promise<Map<string, string[]>>}
 */
async function buildHistoryVolatilityHintsMap() {
  const map = new Map();
  const window = Math.min(
    200,
    Math.max(
      5,
      parseInt(process.env.HISTORY_VOLATILITY_WINDOW_SCANS || "30", 10) || 30
    )
  );
  const minPts = Math.max(
    3,
    parseInt(process.env.HISTORY_VOLATILITY_MIN_POINTS || "5", 10) || 5
  );
  const minStd = Math.max(
    0,
    parseFloat(process.env.HISTORY_VOLATILITY_STDDEV_SPREAD_MIN || "0.12") ||
      0.12
  );
  const minRange = Math.max(
    0,
    parseFloat(process.env.HISTORY_VOLATILITY_RANGE_SPREAD_MIN || "0.35") ||
      0.35
  );
  const onlyDyn = truthyDynamicOnly();

  let scans;
  try {
    scans = await readRecentScanLines(window);
  } catch {
    return map;
  }
  if (!Array.isArray(scans) || scans.length === 0) return map;

  /** @type {Map<string, number[]>} */
  const spreadsById = new Map();

  for (const scan of scans) {
    for (const m of scan.markets || []) {
      if (!m || m.disabled || m.error || !m.id) continue;
      if (onlyDyn && !String(m.id).startsWith("dyn-")) continue;
      const sp = m.spreadPercent;
      if (sp == null || !Number.isFinite(sp)) continue;
      if (!spreadsById.has(m.id)) spreadsById.set(m.id, []);
      spreadsById.get(m.id).push(sp);
    }
  }

  for (const [id, spreads] of spreadsById) {
    if (spreads.length < minPts) continue;
    const std = sampleStdevPct(spreads);
    const lo = Math.min(...spreads);
    const hi = Math.max(...spreads);
    const range = hi - lo;
    const hints = [];
    if (std >= minStd) {
      hints.push(
        `Volatilidade (últimos ${scans.length} scans): desvio-padrão do spread modelo σ=${std.toFixed(3)}% (${spreads.length} pontos) — possível ruído de quotes ou regime instável.`
      );
    }
    if (range >= minRange) {
      hints.push(
        `Volatilidade (últimos ${scans.length} scans): amplitude do spread modelo ${range.toFixed(3)}% (min ${lo.toFixed(3)}% · max ${hi.toFixed(3)}%) — comparar com liquidez e idade das quotes.`
      );
    }
    if (hints.length) map.set(id, hints);
  }

  return map;
}

module.exports = { buildHistoryVolatilityHintsMap, sampleStdevPct };
