/**
 * Filtros de qualidade e métricas para o scan (spread mínimo, liquidez vs notional).
 */

function minSpreadPercent() {
  const v = parseFloat(process.env.MIN_SPREAD_PERCENT || "0");
  if (!Number.isFinite(v) || v < 0) return 0;
  return v;
}

/**
 * Liquidez mínima para mercados dinâmicos: max(DYNAMIC_MIN_LIQ_USD, notional * mult) se mult > 0.
 */
function dynamicMinLiquidityUsd(notionalUsd) {
  const base = Number(process.env.DYNAMIC_MIN_LIQ_USD || 2500);
  const mult = parseFloat(process.env.DYNAMIC_LIQ_NOTIONAL_MULT || "0");
  if (!Number.isFinite(mult) || mult <= 0) return base;
  const n = Number(notionalUsd);
  const fromNotional =
    Number.isFinite(n) && n > 0 ? n * mult : 0;
  return Math.max(base, fromNotional);
}

function applyWorthwhileGates(analysis) {
  const a =
    analysis && typeof analysis === "object" ? { ...analysis } : analysis;
  if (!a || typeof a !== "object") return a;
  const minPct = minSpreadPercent();
  if (
    a.worthwhile &&
    minPct > 0 &&
    typeof a.spreadPercent === "number" &&
    Number.isFinite(a.spreadPercent) &&
    a.spreadPercent < minPct
  ) {
    a.worthwhile = false;
    a.suppressionReason = "min_spread";
  }
  return a;
}

module.exports = {
  minSpreadPercent,
  dynamicMinLiquidityUsd,
  applyWorthwhileGates
};
