/**
 * Orquestração “dados reais”: combina RPC (`rpc-evm`), CoinGecko (`coingecko-native-usd`)
 * e lógica local (cache gas USD, `enrichPoolRow`, `estimateGas`).
 *
 * Fontes isoladas: `lib/sources/rpc-evm.js`, `lib/sources/coingecko-native-usd.js`.
 */

const { formatEther } = require("ethers");
const { withRpcRetry } = require("./rpc-resilience");
const { getQuoteSimBlockOverrides } = require("./quote-sim-options");
const scanDiag = require("./scan-diagnostics");

const {
  KNOWN_EVM_CHAINS,
  fetchNativeUsdForChain
} = require("./sources/coingecko-native-usd");

const {
  rpcUrlForChain,
  rpcUrlsForChain,
  hasAnyRpc,
  getProvider,
  gasLimitForChain,
  getWeiEffectiveGasPrice,
  readV3StylePoolFeeBps
} = require("./sources/rpc-evm");

const CACHE_MS = parseInt(process.env.REAL_METRICS_CACHE_MS || "20000", 10);

const gasUsdByChain = new Map();

function useRealChainData() {
  const e = process.env.USE_REAL_CHAIN_DATA;
  if (e === "0" || e === "false") return false;
  if (e === "1" || e === "true") return true;
  return hasAnyRpc(KNOWN_EVM_CHAINS);
}

/**
 * Custo estimado de **uma** transação de swap (USD), cache por chain.
 */
async function getTxGasUsd(chainSlug, cgSink) {
  const c = chainSlug.toLowerCase();
  if (c === "solana") return null;

  if (!useRealChainData()) return null;

  const prov = getProvider(c);
  if (!prov) return null;

  const hit = gasUsdByChain.get(c);
  if (hit && Date.now() - hit.ts < CACHE_MS) return hit.usd;

  const [wei, nativeUsd] = await Promise.all([
    getWeiEffectiveGasPrice(prov),
    fetchNativeUsdForChain(c, cgSink)
  ]);
  if (nativeUsd == null || wei <= 0n) return null;

  const gasLimit = BigInt(gasLimitForChain(c));
  const costWei = wei * gasLimit;
  const costEth = parseFloat(formatEther(costWei));
  const usd = costEth * nativeUsd;
  if (!Number.isFinite(usd) || usd < 0) return null;

  gasUsdByChain.set(c, { ts: Date.now(), usd });
  return usd;
}

function resolveFeeBpsFromPool(pool, defaultSwapFeeBps) {
  if (
    typeof pool.feeBps === "number" &&
    Number.isFinite(pool.feeBps) &&
    pool.feeBps >= 0
  ) {
    return pool.feeBps;
  }
  return defaultSwapFeeBps;
}

/**
 * @param {{ coingecko?: { errors?: number, lastError?: string | null } } | null} [cgSink]
 * @returns {{ feeBps: number, feeSource: 'onchain'|'config'|'default', gasUsdTx: number|null }}
 */
async function enrichPoolRow(chainSlug, pool, defaultSwapFeeBps, cgSink) {
  let feeBps = resolveFeeBpsFromPool(pool, defaultSwapFeeBps);
  let feeSource =
    typeof pool.feeBps === "number" && Number.isFinite(pool.feeBps)
      ? "config"
      : "default";
  let gasUsdTx = null;

  if (!useRealChainData()) {
    return { feeBps, feeSource, gasUsdTx };
  }

  const onFee = await readV3StylePoolFeeBps(chainSlug, pool.pair);
  if (onFee != null) {
    feeBps = onFee;
    feeSource = "onchain";
  }

  gasUsdTx = await getTxGasUsd(chainSlug, cgSink);

  return { feeBps, feeSource, gasUsdTx };
}

function getRealDataSummary() {
  const rpcConfigured = {};
  for (const ch of KNOWN_EVM_CHAINS) {
    rpcConfigured[ch] = Boolean(rpcUrlForChain(ch));
  }
  return {
    useRealChainData: useRealChainData(),
    priceSource:
      "curados_EVM: onchain_roundtrip (Quoter/V2/Aerodrome) se RPC; senão DexScreener. Dinâmicos: DexScreener.",
    nativeUsdSource: "coingecko_simple",
    rpcConfigured,
    gasModel:
      useRealChainData() && hasAnyRpc(KNOWN_EVM_CHAINS)
        ? "rpc_wei_effective × SWAP_GAS_LIMIT × native_usd"
        : "static_gasCostUsdByChain",
    poolFeeModel: useRealChainData()
      ? "onchain_fee()_when_v3_style_else_config"
      : "config_or_DEFAULT_SWAP_FEE_BPS",
    slippageOrImpact:
      useRealChainData()
        ? "liquidity_usd_impact_estimate_when_both_pools_report_liquidity"
        : "fixed_SLIPPAGE_BPS_on_notional",
    curatedOnChainQuotes:
      process.env.DISABLE_CURATED_ONCHAIN_QUOTES === "1"
        ? "disabled"
        : "auto_when_rpc",
    quoteSimBlockTag:
      process.env.QUOTE_SIM_BLOCK_TAG && String(process.env.QUOTE_SIM_BLOCK_TAG).trim()
        ? String(process.env.QUOTE_SIM_BLOCK_TAG).trim()
        : null
  };
}

/**
 * @param {{ to: string, data: string, from: string }} tx
 * @param {{ coingecko?: { errors?: number, lastError?: string | null } } | null} [cgSink]
 */
async function estimateTxGasUsd(chainSlug, tx, cgSink) {
  const c = chainSlug.toLowerCase();
  if (c === "solana") return null;
  const prov = getProvider(c);
  if (!prov || !tx?.to || !tx?.data || !tx?.from) return null;
  const blockPart = getQuoteSimBlockOverrides();
  const txMerged =
    blockPart && Object.keys(blockPart).length > 0 ? { ...tx, ...blockPart } : tx;
  try {
    return await withRpcRetry(async () => {
      const [wei, gas, nativeUsd] = await Promise.all([
        getWeiEffectiveGasPrice(prov),
        prov.estimateGas(txMerged),
        fetchNativeUsdForChain(c, cgSink)
      ]);
      if (nativeUsd == null || gas <= 0n) return null;
      const costWei = wei * gas;
      const costEth = parseFloat(formatEther(costWei));
      const usd = costEth * nativeUsd;
      return Number.isFinite(usd) && usd >= 0 ? usd : null;
    });
  } catch {
    return null;
  }
}

module.exports = {
  useRealChainData,
  enrichPoolRow,
  getRealDataSummary,
  rpcUrlForChain,
  rpcUrlsForChain,
  getTxGasUsd,
  getProvider,
  estimateTxGasUsd
};
