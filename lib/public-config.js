/**
 * Configuração segura para o painel (sem URLs de RPC nem chaves).
 */

const {
  getRealDataSummary,
  rpcUrlForChain
} = require("./chain-metrics");
const { aggregatorsEnabled } = require("./aggregator-roundtrip");
const { jupiterEnabled } = require("./jupiter-sol");
const { minNetProfitUsd } = require("./profit-threshold");
const { minSpreadPercent, dynamicMinLiquidityUsd } = require("./scan-quality");
const { webhookEnabled } = require("./webhook-notify");
const { getIntentFilterPublicSummary } = require("./scan-intents");
const { rpcUrlsForChain } = require("./sources/rpc-evm");

const CHAINS = [
  "arbitrum",
  "base",
  "polygon",
  "bsc",
  "ethereum",
  "optimism",
  "avalanche",
  "fantom",
  "solana"
];

function getPublicConfig() {
  const rpcConfigured = {};
  for (const c of CHAINS) {
    rpcConfigured[c] = Boolean(rpcUrlForChain(c));
  }
  const rd = getRealDataSummary();
  const rpcEndpointCounts = {};
  for (const c of CHAINS) {
    rpcEndpointCounts[c] = rpcUrlsForChain(c).length;
  }
  return {
    app: "HUNTER_SCANNER",
    notionalUsd: parseFloat(process.env.NOTIONAL_USD || "200"),
    slippageBps: parseInt(process.env.SLIPPAGE_BPS || "20", 10),
    useRealChainData: rd.useRealChainData,
    disableDynamic:
      process.env.DISABLE_DYNAMIC === "1" ||
      process.env.DISABLE_DYNAMIC === "true",
    disableCuratedOnchainQuotes:
      process.env.DISABLE_CURATED_ONCHAIN_QUOTES === "1" ||
      process.env.DISABLE_CURATED_ONCHAIN_QUOTES === "true",
    maxDynamicMarkets: parseInt(process.env.MAX_DYNAMIC_MARKETS || "200", 10),
    dexscreenerConcurrency: parseInt(
      process.env.DEXSCREENER_CONCURRENCY || "4",
      10
    ),
    dexscreenerGlobalConcurrency: parseInt(
      process.env.DEXSCREENER_GLOBAL_CONCURRENCY || "1",
      10
    ),
    scanParallel: parseInt(process.env.SCAN_PARALLEL || "6", 10),
    rpcConfigured,
    gasModel: rd.gasModel,
    poolFeeModel: rd.poolFeeModel,
    priceSource: rd.priceSource,
    scanHistoryEnabled: process.env.ENABLE_SCAN_HISTORY !== "0",
    historyMaxScans: parseInt(process.env.HISTORY_MAX_SCANS || "200", 10),
    historyFile: process.env.HISTORY_FILE || "data/scan-history.jsonl",
    aggregatorsEnabled: aggregatorsEnabled(),
    jupiterSolEnabled: jupiterEnabled(),
    minNetProfitUsd: minNetProfitUsd(),
    minSpreadPercent: minSpreadPercent(),
    quoteMaxAgeSec:
      parseInt(process.env.QUOTE_MAX_AGE_SEC || "0", 10) || null,
    dynamicMinLiquidityUsd: dynamicMinLiquidityUsd(
      parseFloat(process.env.NOTIONAL_USD || "200")
    ),
    webhookEnabled: webhookEnabled(),
    ...getIntentFilterPublicSummary(),
    rpcEndpointCounts,
    flags: {
      USE_REAL_CHAIN_DATA: process.env.USE_REAL_CHAIN_DATA ?? "(auto se existir RPC)",
      DISABLE_CURATED_ONCHAIN_QUOTES:
        process.env.DISABLE_CURATED_ONCHAIN_QUOTES ?? "0",
      DISABLE_DYNAMIC: process.env.DISABLE_DYNAMIC ?? "0",
      ENABLE_AGGREGATORS: process.env.ENABLE_AGGREGATORS ?? "0",
      ENABLE_JUPITER_SOL: process.env.ENABLE_JUPITER_SOL ?? "0",
      ENABLE_SCAN_HISTORY: process.env.ENABLE_SCAN_HISTORY ?? "(ligado; use 0 para desligar)",
      MIN_NET_PROFIT_USD:
        process.env.MIN_NET_PROFIT_USD ?? "(default 1 USD; use 0 para só >0)",
      MIN_SPREAD_PERCENT:
        process.env.MIN_SPREAD_PERCENT ?? "(default 0 = desligado)",
      QUOTE_MAX_AGE_SEC:
        process.env.QUOTE_MAX_AGE_SEC ?? "(default 0 = sem aviso stale)",
      DYNAMIC_LIQ_NOTIONAL_MULT:
        process.env.DYNAMIC_LIQ_NOTIONAL_MULT ?? "(opcional; ex. 1.25)",
      WEBHOOK_URL: process.env.WEBHOOK_URL ? "(definido)" : "(vazio)",
      ENABLE_WEBHOOK: process.env.ENABLE_WEBHOOK ?? "(ligado se WEBHOOK_URL)",
      INTENTS_ONCHAIN_ONLY:
        process.env.INTENTS_ONCHAIN_ONLY ?? "(0 = modelo + onchain)",
      INTENTS_CHAINS:
        process.env.INTENTS_CHAINS ?? "(vazio = todas as chains)",
      INTENTS_MIN_NET_USD:
        process.env.INTENTS_MIN_NET_USD ?? "(vazio = sem filtro extra em cima do scan)",
      RPC_FALLBACK_STALL_MS:
        process.env.RPC_FALLBACK_STALL_MS ?? "(ethers FallbackProvider; default 750)",
      DYNAMIC_MIN_H24_VOLUME_USD:
        process.env.DYNAMIC_MIN_H24_VOLUME_USD ?? "(0 = desligado)",
      DYNAMIC_MAX_VOL_TO_LIQ_RATIO:
        process.env.DYNAMIC_MAX_VOL_TO_LIQ_RATIO ?? "(0 = desligado)",
      DYNAMIC_MIN_PAIR_AGE_HOURS:
        process.env.DYNAMIC_MIN_PAIR_AGE_HOURS ?? "(0 = desligado)",
      DYNAMIC_DEX_ALLOWLIST:
        process.env.DYNAMIC_DEX_ALLOWLIST ?? "(vazio = todos exceto unknown)",
      DYNAMIC_DEX_BLOCKLIST: process.env.DYNAMIC_DEX_BLOCKLIST ?? "(vazio)",
      HISTORY_NOISE_WINDOW_SCANS:
        process.env.HISTORY_NOISE_WINDOW_SCANS ?? "(default 30)",
      HISTORY_NOISE_MODEL_MIN:
        process.env.HISTORY_NOISE_MODEL_MIN ?? "(default 4)",
      HISTORY_NOISE_ONLY_DYNAMIC:
        process.env.HISTORY_NOISE_ONLY_DYNAMIC ?? "(default 1; 0 = todos os ids)"
    },
    docsHint:
      "Defina RPC_<REDE> ou RPC_URLS_JSON no servidor (PowerShell / .env). Vários RPC por rede: separe URLs com vírgula em RPC_<REDE> ou use array em RPC_URLS_JSON. Chaves 1inch/0x e Jupiter só no servidor. Nunca coloque chaves privadas no browser. Webhook opcional: WEBHOOK_URL envia POST (markets + intents filtrados). Teste local: npm run webhook:echo. Filtros de intents: INTENTS_ONCHAIN_ONLY, INTENTS_CHAINS, INTENTS_MIN_NET_USD."
  };
}

module.exports = { getPublicConfig };
