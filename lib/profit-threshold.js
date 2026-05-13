/**
 * Lucro líquido considerado “material” para `worthwhile` e notificações.
 * Abaixo disto trata-se como ruído do modelo (DexScreener, slippage fixo, etc.).
 *
 * Env: MIN_NET_PROFIT_USD (default 1). Use 0 para o comportamento antigo (> 0).
 */

function minNetProfitUsd() {
  const raw = process.env.MIN_NET_PROFIT_USD;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return 1;
  }
  const v = parseFloat(String(raw));
  if (!Number.isFinite(v) || v < 0) return 1;
  return v;
}

function isWorthwhileNet(netProfitUsd) {
  if (typeof netProfitUsd !== "number" || !Number.isFinite(netProfitUsd)) {
    return false;
  }
  return netProfitUsd > minNetProfitUsd();
}

module.exports = { minNetProfitUsd, isWorthwhileNet };
