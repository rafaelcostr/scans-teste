/**
 * Métricas estruturadas de sinal no modelo (DexScreener), além dos avisos em texto.
 * Hoje: Polygon — mediana do preço implícito de WETH (USD) por tipo de stable no quote,
 * e desvio implícito entre stables (basis points), útil para separar “spread” de peg/depeg.
 */

const { stableInfoFromTokens, normAddr } = require("./stable-model-warnings");

/** WETH nativo Polygon (minúsculas) */
const WETH_POLYGON = "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619";

const STABLE_LABEL = {
  "usdc.e": "USDC.e",
  "usdc.native": "USDC nativo",
  usdt: "USDT",
  dai: "DAI"
};

/**
 * @param {string} chain
 * @param {Array<{ price: number, dex: string, baseToken?: object, quoteToken?: object }>} rows
 * @returns {{ stablePeg: object | null }}
 */
function computeSignalModelMetrics(chain, rows) {
  const c = String(chain || "").toLowerCase();
  const out = { stablePeg: null };
  if (c !== "polygon" || !Array.isArray(rows) || rows.length < 2) {
    return out;
  }

  /** @type {Map<string, number[]>} */
  const byStable = new Map();

  for (const r of rows) {
    const info = stableInfoFromTokens(r.baseToken, r.quoteToken);
    if (info?.kind !== "one_stable") continue;
    const baddr = normAddr(r.baseToken?.address);
    if (!baddr || baddr !== WETH_POLYGON) continue;
    const p = Number(r.price);
    if (!Number.isFinite(p) || p <= 0) continue;
    const k = info.stable.key;
    if (!byStable.has(k)) byStable.set(k, []);
    byStable.get(k).push(p);
  }

  if (byStable.size < 2) {
    return out;
  }

  const medians = {};
  for (const [k, arr] of byStable) {
    const s = [...arr].sort((a, b) => a - b);
    medians[k] = s[Math.floor(s.length / 2)];
  }

  const keys = Object.keys(medians);
  const cross = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const ka = keys[i];
      const kb = keys[j];
      const a = medians[ka];
      const b = medians[kb];
      const hi = Math.max(a, b);
      const lo = Math.min(a, b);
      const basisBps = ((hi / lo - 1) * 10000);
      cross.push({
        stableA: ka,
        stableB: kb,
        stableALabel: STABLE_LABEL[ka] || ka,
        stableBLabel: STABLE_LABEL[kb] || kb,
        basisBps: Math.round(basisBps * 100) / 100,
        medianUsdA: a,
        medianUsdB: b
      });
    }
  }
  cross.sort((u, v) => v.basisBps - u.basisBps);

  out.stablePeg = {
    mediansWethUsdByStable: medians,
    crossStableBasisBps: cross
  };
  return out;
}

module.exports = { computeSignalModelMetrics };
