/**
 * Intents: resumo acionável para executor externo ou automações.
 * Não inclui chaves nem calldata — só contexto verificável no último scan.
 *
 * Filtros opcionais (após worthwhile do scan):
 *   INTENTS_ONCHAIN_ONLY=1 — só mode "onchain"
 *   INTENTS_CHAINS=arbitrum,base — lista de chains (minúsculas, separador , ; ou espaço)
 *   INTENTS_MIN_NET_USD=5 — lucro líquido mínimo extra (USD), além do MIN_NET_PROFIT_USD do scan
 */

function intentsOnchainOnly() {
  return (
    process.env.INTENTS_ONCHAIN_ONLY === "1" ||
    process.env.INTENTS_ONCHAIN_ONLY === "true"
  );
}

function intentsMinNetUsdExtra() {
  const v = parseFloat(process.env.INTENTS_MIN_NET_USD || "");
  if (!Number.isFinite(v) || v < 0) return null;
  return v;
}

function parseIntentChainsSet() {
  const raw = process.env.INTENTS_CHAINS;
  if (!raw || !String(raw).trim()) return null;
  const set = new Set(
    String(raw)
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  return set.size ? set : null;
}

/**
 * Resumo seguro para o painel (sem expor lista completa de chains no env).
 */
function getIntentFilterPublicSummary() {
  const chains = parseIntentChainsSet();
  return {
    intentsOnchainOnly: intentsOnchainOnly(),
    intentsChainsFilterActive: Boolean(chains),
    intentsMinNetUsdExtra: intentsMinNetUsdExtra()
  };
}

/**
 * @param {object[]} intents
 * @returns {object[]}
 */
function applyIntentEnvFilters(intents) {
  if (!Array.isArray(intents)) return [];
  let list = intents.slice();
  const chainSet = parseIntentChainsSet();
  if (chainSet) {
    list = list.filter((i) =>
      chainSet.has(String(i.chain || "").toLowerCase())
    );
  }
  if (intentsOnchainOnly()) {
    list = list.filter((i) => i.mode === "onchain");
  }
  const minExtra = intentsMinNetUsdExtra();
  if (minExtra != null) {
    list = list.filter(
      (i) =>
        typeof i.netProfitUsd === "number" &&
        Number.isFinite(i.netProfitUsd) &&
        i.netProfitUsd >= minExtra
    );
  }
  return list;
}

/**
 * @param {object} scan — saída de runScan()
 */
function buildIntentsFromScan(scan) {
  const out = [];
  const notional = scan.params?.notionalUsd ?? 200;
  const slip = scan.params?.slippageBps ?? 20;
  for (const m of scan.markets || []) {
    if (!m || m.disabled || m.error || !m.analysis) continue;
    if (!m.analysis.worthwhile) continue;
    const a = m.analysis;
    out.push({
      marketId: m.id,
      chain: m.chain,
      label: m.label,
      dynamic: Boolean(m.dynamic),
      notionalUsd: notional,
      slippageBps: slip,
      mode: a.onChainRoundtrip ? "onchain" : "model",
      jupiterRoundtrip: Boolean(a.jupiterRoundtrip),
      aggregatorRoundtrip: Boolean(a.aggregatorRoundtrip),
      buyDex: a.buyDex,
      sellDex: a.sellDex,
      netProfitUsd: a.netProfitUsd,
      spreadPercent: a.spreadPercent,
      grossProfitUsd: a.grossProfitUsd,
      gasSource: a.gasSource,
      prices: (m.prices || []).map((p) => ({
        dex: p.dex,
        price: p.price,
        feeBps: p.feeBps,
        quoteFetchedAt: p.quoteFetchedAt || null
      })),
      scanUpdatedAt: scan.updatedAt
    });
  }
  return applyIntentEnvFilters(out);
}

module.exports = {
  buildIntentsFromScan,
  applyIntentEnvFilters,
  getIntentFilterPublicSummary
};
