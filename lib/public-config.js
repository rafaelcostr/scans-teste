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
const {
  executorApiConfigured,
  executorKillSwitch
} = require("./execution-auth");
const {
  buildRpcHealthSummary,
  circuitBreakerEnabled
} = require("./rpc-circuit-metrics");
const { getDexscreenerTelemetrySummary } = require("./dexscreener-telemetry");
const { getRiskPolicyPublicSummary } = require("./risk-policy");

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
    app: "DEX_SCANNER",
    notionalUsd: parseFloat(process.env.NOTIONAL_USD || "200"),
    slippageBps: parseInt(process.env.SLIPPAGE_BPS || "20", 10),
    scanUiPollMs: parseInt(process.env.SCAN_UI_POLL_MS || "15000", 10),
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
    executorApiConfigured: executorApiConfigured(),
    executorKillSwitchActive: executorKillSwitch(),
    ...getRiskPolicyPublicSummary(),
    ...getIntentFilterPublicSummary(),
    rpcEndpointCounts,
    rpcHealth: buildRpcHealthSummary(CHAINS),
    rpcCircuitBreaker: circuitBreakerEnabled(),
    dexscreenerTelemetry: getDexscreenerTelemetrySummary({ limit: 15 }),
    quoteSimBlockTag: rd.quoteSimBlockTag || null,
    flags: {
      USE_REAL_CHAIN_DATA: process.env.USE_REAL_CHAIN_DATA ?? "(auto se existir RPC)",
      SCAN_UI_POLL_MS:
        process.env.SCAN_UI_POLL_MS ?? "(default 15000)",
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
      WEBHOOK_MAX_RETRIES: process.env.WEBHOOK_MAX_RETRIES ?? "(default 5)",
      WEBHOOK_RETRY_BACKOFF_MS: process.env.WEBHOOK_RETRY_BACKOFF_MS ?? "(default 500)",
      WEBHOOK_MINIMAL_PAYLOAD: process.env.WEBHOOK_MINIMAL_PAYLOAD ?? "(0 = corpo completo com intents)",
      WEBHOOK_PUBLIC_BASE_URL: process.env.WEBHOOK_PUBLIC_BASE_URL ?? "(vazio = links relativos /api/…)",
      INTENTS_ONCHAIN_ONLY:
        process.env.INTENTS_ONCHAIN_ONLY ?? "(0 = modelo + onchain)",
      INTENTS_CHAINS:
        process.env.INTENTS_CHAINS ?? "(vazio = todas as chains)",
      INTENTS_MIN_NET_USD:
        process.env.INTENTS_MIN_NET_USD ?? "(vazio = sem filtro extra em cima do scan)",
      RPC_FALLBACK_STALL_MS:
        process.env.RPC_FALLBACK_STALL_MS ?? "(ethers FallbackProvider; default 750)",
      RPC_CIRCUIT_BREAKER:
        process.env.RPC_CIRCUIT_BREAKER ?? "(1 = trip por endpoint; 0 = só métricas)",
      RPC_CB_FAILURE_THRESHOLD:
        process.env.RPC_CB_FAILURE_THRESHOLD ?? "(default 4 falhas seguidas)",
      RPC_CB_COOLDOWN_MS:
        process.env.RPC_CB_COOLDOWN_MS ?? "(default 45000; mín 100 ms)",
      QUOTE_SIM_BLOCK_TAG:
        process.env.QUOTE_SIM_BLOCK_TAG ?? "(vazio = latest; pending|safe|nº|0x…)",
      AGGREGATOR_POLYGON_STABLE:
        process.env.AGGREGATOR_POLYGON_STABLE ?? "(default USDC nativo Polygon)",
      AGGREGATOR_POLYGON_STABLE_DECIMALS:
        process.env.AGGREGATOR_POLYGON_STABLE_DECIMALS ?? "(default 6)",
      DEXSCREENER_TELEMETRY: process.env.DEXSCREENER_TELEMETRY ?? "(1; 0 = desliga)",
      WEBHOOK_DEDUPE_FINGERPRINT:
        process.env.WEBHOOK_DEDUPE_FINGERPRINT ?? "(0; 1 = não reenviar mesmo fingerprint)",
      WEBHOOK_DEDUPE_WINDOW_MS:
        process.env.WEBHOOK_DEDUPE_WINDOW_MS ?? "(default 120000)",
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
        process.env.HISTORY_NOISE_ONLY_DYNAMIC ?? "(default 1; 0 = todos os ids)",
      HISTORY_VOLATILITY_WINDOW_SCANS:
        process.env.HISTORY_VOLATILITY_WINDOW_SCANS ?? "(default 30)",
      HISTORY_VOLATILITY_MIN_POINTS:
        process.env.HISTORY_VOLATILITY_MIN_POINTS ?? "(default 5)",
      HISTORY_VOLATILITY_STDDEV_SPREAD_MIN:
        process.env.HISTORY_VOLATILITY_STDDEV_SPREAD_MIN ?? "(default 0.12 %)",
      HISTORY_VOLATILITY_RANGE_SPREAD_MIN:
        process.env.HISTORY_VOLATILITY_RANGE_SPREAD_MIN ?? "(default 0.35 %)",
      HISTORY_VOLATILITY_ONLY_DYNAMIC:
        process.env.HISTORY_VOLATILITY_ONLY_DYNAMIC ?? "(default 1)",
      DYNAMIC_SYMBOL_HEURISTICS:
        process.env.DYNAMIC_SYMBOL_HEURISTICS ?? "(default ligado; 0 = desliga)",
      EXECUTOR_API_KEY: process.env.EXECUTOR_API_KEY ? "(definido)" : "(vazio)",
      EXECUTOR_QUEUE_MAX: process.env.EXECUTOR_QUEUE_MAX ?? "(default 100)",
      EXECUTOR_KILL_SWITCH: process.env.EXECUTOR_KILL_SWITCH ?? "(0)",
      EXECUTOR_MAX_PROFIT_DRIFT_USD:
        process.env.EXECUTOR_MAX_PROFIT_DRIFT_USD ?? "(default 0.08)",
      RISK_POLICY_DISABLED:
        process.env.RISK_POLICY_DISABLED ?? "(0 = risk gate ligado)",
      RISK_REQUIRE_ONCHAIN:
        process.env.RISK_REQUIRE_ONCHAIN ?? "(default 1)",
      RISK_ALLOW_DYNAMIC:
        process.env.RISK_ALLOW_DYNAMIC ?? "(default 0)",
      RISK_ALLOWED_CHAINS:
        process.env.RISK_ALLOWED_CHAINS ?? "(vazio = todas)",
      RISK_MAX_NOTIONAL_USD:
        process.env.RISK_MAX_NOTIONAL_USD ?? "(default 250)",
      RISK_MIN_NET_PROFIT_USD:
        process.env.RISK_MIN_NET_PROFIT_USD ?? "(default 2)",
      RISK_MIN_PROFIT_BUFFER_USD:
        process.env.RISK_MIN_PROFIT_BUFFER_USD ?? "(default 0.25)",
      RISK_MAX_SLIPPAGE_BPS:
        process.env.RISK_MAX_SLIPPAGE_BPS ?? "(default 50)",
      RISK_MAX_QUOTE_AGE_SEC:
        process.env.RISK_MAX_QUOTE_AGE_SEC ?? "(default 20)",
      PAPER_LOOP_INTERVAL_MS:
        process.env.PAPER_LOOP_INTERVAL_MS ?? "(default 15000)",
      PAPER_START_BALANCE_USD:
        process.env.PAPER_START_BALANCE_USD ?? "(default 200)",
      PAPER_TRADES_FILE:
        process.env.PAPER_TRADES_FILE ?? "data/paper-trades.jsonl",
      PAPER_LOG_DISABLED:
        process.env.PAPER_LOG_DISABLED ?? "(0)"
    },
    docsHint:
      "Defina RPC_<REDE> ou RPC_URLS_JSON no servidor (PowerShell / .env). Vários RPC por rede: vírgula ou RPC_URLS_JSON. Métricas RPC: rpcHealth em GET /api/config. Sim on-chain opcionalmente com QUOTE_SIM_BLOCK_TAG (ex. pending). Polygon + agregadores: AGGREGATOR_POLYGON_STABLE (endereço do USDC a usar). Telemetria DexScreener: dexscreenerTelemetry no /api/config (DEXSCREENER_TELEMETRY=0 desliga). Webhook: HMAC + retries; WEBHOOK_DEDUPE_FINGERPRINT=1 evita reenvio duplicado do mesmo conjunto de oportunidades. Executor dry-run: EXECUTOR_API_KEY. Ver README.md para segurança (rate limit, secrets). Filtros intents: INTENTS_ONCHAIN_ONLY, INTENTS_CHAINS, INTENTS_MIN_NET_USD."
  };
}

module.exports = { getPublicConfig };
