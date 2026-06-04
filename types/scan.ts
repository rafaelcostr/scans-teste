/**
 * Domínio partilhado: análise de mercado, params do scan, respostas HTTP.
 * O runtime continua em JS; estes tipos servem para `tsc --noEmit` e documentação.
 */

export type SlippageMode = "bps" | "impact";

export interface StablePegCrossMetric {
  stableA: string;
  stableB: string;
  stableALabel: string;
  stableBLabel: string;
  basisBps: number;
  medianUsdA: number;
  medianUsdB: number;
}

export interface SignalModelMetrics {
  stablePeg?: {
    mediansWethUsdByStable: Record<string, number>;
    crossStableBasisBps: StablePegCrossMetric[];
  } | null;
}

export type GasPriceSource =
  | "rpc"
  | "table"
  | "rpc_estimateGas"
  | "rpc_swap_limit_x2"
  | "rpc_table";

export interface MarketDiagDexscreener {
  requests: number;
  errors: number;
  lastError: string | null;
  cacheHits: number;
}

export interface MarketDiagCoingecko {
  errors: number;
  lastError: string | null;
}

export interface MarketDiagnostics {
  marketId: string;
  dexscreener: MarketDiagDexscreener;
  coingecko: MarketDiagCoingecko;
}

/** Pool curado como aparece em `normalizePools` / DexScreener */
export interface CuratedPoolInput {
  name: string;
  pair: string;
  chain: string;
  feeBps?: number;
  gasCostUsd?: number;
}

/** Resposta mínima da API DexScreener usada pelo scanner */
export interface DexScreenerPairQuote {
  price: number;
  liquidityUsd: number | null;
  quoteFetchedAt: string;
}

/** Análise “modelo” (spread + custos) ou base comum a modos reais */
export interface MarketAnalysisBase {
  marketLabel: string;
  chain: string;
  buyDex: string;
  sellDex: string;
  buyPrice: number;
  sellPrice: number;
  buyFeeBps: number;
  sellFeeBps: number;
  buyFeeSource: string;
  sellFeeSource: string;
  spreadPercent: number;
  grossProfitUsd: number;
  gasCostUsd: number;
  gasSource: GasPriceSource;
  slippageUsd: number;
  slippageMode: SlippageMode;
  poolFeesUsd: number;
  costsUsd: number;
  netProfitUsd: number;
  worthwhile: boolean;
  suppressionReason?: string;
  /** Avisos do modelo DexScreener (ex.: stables diferentes em Polygon) */
  modelWarnings?: string[];
  /** Métricas estruturadas de sinal (ex.: peg implícito entre stables em Polygon) */
  signalModelMetrics?: SignalModelMetrics | null;
}

/** Extensões quando há simulação on-chain / Jupiter / agregador */
export interface MarketAnalysisExtensions {
  onChainRoundtrip?: boolean;
  jupiterRoundtrip?: boolean;
  aggregatorRoundtrip?: boolean;
  aggregatorProvider?: string;
  aggregatorLegProvider?: string;
  stableBackHuman?: number;
  collateralSymbol?: string;
  quoteFetchedAt?: string;
  note?: string;
  feesIncludedInQuote?: boolean;
}

export type MarketAnalysis = MarketAnalysisBase &
  MarketAnalysisExtensions & {
    explanation: string[];
  };

export interface ScanDiagnosticsDexAgg {
  requests: number;
  errors: number;
  lastError: string | null;
  cacheHits: number;
}

export interface ScanDiagnostics {
  dexscreener: ScanDiagnosticsDexAgg;
  coingecko: { errors: number; lastError: string | null };
  byMarket: Array<{
    marketId: string;
    dexscreener: MarketDiagDexscreener;
    coingecko: MarketDiagCoingecko;
  }>;
}

export interface ScanParams {
  notionalUsd: number;
  slippageBps: number;
  minNetProfitUsd?: number;
  defaultSwapFeeBps: number;
  gasCostUsdByChain: Record<string, number>;
  useRealChainData: boolean;
  priceSource: string;
  nativeUsdSource?: string;
  rpcConfigured: Record<string, boolean>;
  gasModel: string;
  poolFeeModel: string;
  slippageOrImpact?: string;
  curatedOnChainQuotes?: string;
  seedTokensFileLoaded: boolean;
  dynamicDisabled: boolean;
  maxDynamicMarkets: number;
  scanDurationMs?: number;
  dynamicTemplates?: number;
  dynamicScanned?: number;
  diagnostics?: ScanDiagnostics;
  minSpreadPercent?: number;
  quoteMaxAgeSec?: number | null;
  dynamicMinLiquidityUsd?: number;
}

export interface PriceQuoteRow {
  dex: string;
  chain: string;
  price: number;
  feeBps: number;
  feeSource: string;
  priceSource?: string | null;
  quoteFetchedAt?: string | null;
  liquidityUsd?: number | null;
  gasUsdTx?: number | null;
  pool?: unknown;
  baseToken?: { address: string; symbol?: string | null } | null;
  quoteToken?: { address: string; symbol?: string | null } | null;
}

export interface MarketConfidence {
  rpcOk: boolean;
  rpcLabel: string;
  dexscreenerLastError: string | null;
  coingeckoLastError: string | null;
  quoteFetchedAt: string | null;
  priceSource: string | null;
  scanDurationMs?: number | null;
  quoteAgeSec?: number | null;
  quotesStale?: boolean;
  quoteMaxAgeSec?: number | null;
}

export interface OnChainSimFailure {
  code: string;
  reason: string;
}

export interface ScanMarketDisabled {
  id: string;
  label: string;
  chain: string;
  disabled: true;
  setupNote?: string;
  note?: string;
  historyHints?: string[];
}

export interface ScanMarketError {
  id: string;
  label: string;
  chain: string;
  error: string;
  note?: string;
  dynamic?: boolean;
  historyHints?: string[];
  onChainSimFailure?: OnChainSimFailure;
  confidence?: MarketConfidence;
}

export interface ScanMarketOk {
  id: string;
  label: string;
  chain: string;
  note?: string;
  dynamic?: boolean;
  historyHints?: string[];
  prices: PriceQuoteRow[];
  confidence?: MarketConfidence;
  analysis: MarketAnalysis;
  onChainSimFailure?: OnChainSimFailure;
}

export type ScanMarketResult = ScanMarketDisabled | ScanMarketError | ScanMarketOk;

/** Mercado worthwhile acionável (sem chaves nem calldata) — ver GET /api/intents */
export interface ScanIntent {
  marketId: string;
  chain: string;
  label: string;
  dynamic: boolean;
  notionalUsd: number;
  slippageBps: number;
  mode: "onchain" | "model";
  jupiterRoundtrip: boolean;
  aggregatorRoundtrip: boolean;
  buyDex: string;
  sellDex: string;
  netProfitUsd: number;
  spreadPercent: number;
  grossProfitUsd: number;
  gasSource: string;
  prices: Array<{
    dex: string;
    price: number;
    feeBps: number;
    quoteFetchedAt: string | null;
  }>;
  scanUpdatedAt: string;
}

/** Saída de `runScan()` serializada em `GET /api/scan` */
export interface ScanOutput {
  updatedAt: string;
  params: ScanParams;
  markets: ScanMarketResult[];
  intents?: ScanIntent[];
  error?: string;
}

/** `GET /api/history` */
export interface ApiHistoryPoint {
  t: number;
  updatedAt?: string;
  marketId: string;
  chain: string;
  label: string;
  netProfitUsd: number | null;
  spreadPercent: number | null;
  worthwhile: boolean;
}

export interface ApiHistoryResponse {
  points: ApiHistoryPoint[];
  updatedAt: string;
}

/** Métricas RPC agregadas por rede (desde arranque do processo) — GET /api/config `rpcHealth` */
export interface RpcHealthPerChain {
  callsOk: number;
  callsErr: number;
  meanLatencyOkMs: number | null;
  endpointsCircuitOpen: number;
  circuitBreaker: boolean;
}

/** Estado da fila in-memory — `GET /api/executor/queue` (campo `queue`) */
export interface ExecutorQueueState {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  max: number;
}

/** Linha resumida de job na lista — `GET /api/executor/queue` (campo `jobs`) */
export interface ExecutorJobListRow {
  id: string;
  status: string;
  createdAt: string;
  marketId?: string;
  chain?: string;
  mode?: string;
  netProfitUsd?: number;
  error?: string | null;
  result?: unknown;
}

/** Plano dry-run devolvido por `POST /api/executor/tick` quando `passed` */
export interface ExecutorDryRunPlan {
  action: "external_swap_route_required";
  chain?: string;
  marketId?: string;
  label?: string;
  mode?: string;
  buyDex?: string;
  sellDex?: string;
  notionalUsd?: number;
  slippageBps?: number;
  netProfitUsd?: number;
  note?: string;
  /** Dicas para um executor externo (nonce, gas, slippage, endpoints). */
  executorHints?: Record<string, unknown>;
}

export interface ExecutorDryRunResultPassed {
  dryRun: true;
  passed: true;
  plan: ExecutorDryRunPlan;
}

export interface ExecutorDryRunResultFailed {
  dryRun: true;
  passed: false;
  reason?: string;
  hint?: string;
}

/** `POST /api/executor/enqueue` — 200 */
export interface ExecutorEnqueueResponse {
  ok: true;
  added: number;
  skipped: number;
  dropped: number;
  ids: string[];
  scanUpdatedAt?: string;
}

/** `POST /api/executor/tick` — 200 com job */
export interface ExecutorTickResponseWithJob {
  ok: true;
  jobId: string;
  status: "completed" | "failed" | "processing";
  result: ExecutorDryRunResultPassed | ExecutorDryRunResultFailed;
  queue: ExecutorQueueState;
}

/** `POST /api/executor/tick` — 200 fila vazia */
export interface ExecutorTickResponseEmpty {
  ok: true;
  message: "queue_empty";
  queue: ExecutorQueueState;
}

/** `GET /api/executor/queue` — 200 */
export interface ExecutorQueueListResponse {
  queue: ExecutorQueueState;
  jobs: ExecutorJobListRow[];
}
