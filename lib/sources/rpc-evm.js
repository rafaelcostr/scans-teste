/**
 * Fonte RPC EVM: provider, gas price efetivo, fee tier V3-style (`fee()`).
 * Suporta vários URLs por rede (RPC_<REDE> com vírgula, ou array em RPC_URLS_JSON).
 */

const { FallbackProvider, Contract } = require("ethers");
const { withRpcRetry } = require("../rpc-resilience");
const {
  InstrumentedJsonRpcProvider
} = require("./instrumented-json-rpc-provider");

const FEE_ABI = ["function fee() view returns (uint24)"];

const CACHE_MS = parseInt(process.env.REAL_METRICS_CACHE_MS || "20000", 10);

const providersByKey = new Map();
const feeBpsByChainAddr = new Map();

/**
 * Parte uma string de env em vários URLs (http/https).
 * @param {string} [raw]
 * @returns {string[]}
 */
function parseUrlList(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(/[,;\n\r]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

/**
 * Lista de RPC por chain (ordem = prioridade do fallback).
 * @param {string} chain
 * @returns {string[]}
 */
function rpcUrlsForChain(chain) {
  const c = chain.toLowerCase();
  const up = `RPC_${c.toUpperCase().replace(/-/g, "_")}`;
  const direct =
    process.env[up] ||
    process.env[`RPC_${c}`] ||
    process.env[`RPC_${c.toUpperCase()}`];
  const out = [];
  const seen = new Set();
  function push(u) {
    const x = String(u).trim();
    if (!x || seen.has(x)) return;
    seen.add(x);
    out.push(x);
  }
  for (const u of parseUrlList(direct || "")) {
    push(u);
  }
  const raw = process.env.RPC_URLS_JSON;
  if (raw) {
    try {
      const m = JSON.parse(raw);
      const v = m && m[c];
      if (Array.isArray(v)) {
        for (const item of v) {
          for (const u of parseUrlList(String(item))) push(u);
        }
      } else if (v) {
        for (const u of parseUrlList(String(v))) push(u);
      }
    } catch (_) {
      /* ignore */
    }
  }
  return out;
}

function rpcUrlForChain(chain) {
  const urls = rpcUrlsForChain(chain);
  return urls[0] || null;
}

function hasAnyRpc(knownChains) {
  for (const ch of knownChains) {
    if (rpcUrlsForChain(ch).length > 0) return true;
  }
  return false;
}

function getProvider(chainSlug) {
  const urls = rpcUrlsForChain(chainSlug);
  if (urls.length === 0) return null;
  const key = urls.join("|");
  if (providersByKey.has(key)) {
    return providersByKey.get(key);
  }
  const stallMs = parseInt(process.env.RPC_FALLBACK_STALL_MS || "750", 10);
  let p;
  const chainKey = String(chainSlug).toLowerCase();
  if (urls.length === 1) {
    p = new InstrumentedJsonRpcProvider(urls[0], chainKey, 0);
  } else {
    const configs = urls.map((url, i) => ({
      provider: new InstrumentedJsonRpcProvider(url, chainKey, i),
      stallTimeout: stallMs,
      priority: i,
      weight: 1
    }));
    p = new FallbackProvider(configs);
  }
  providersByKey.set(key, p);
  return p;
}

function gasLimitForChain(chain) {
  const c = chain.toLowerCase();
  const spec =
    process.env[`SWAP_GAS_LIMIT_${c.toUpperCase().replace(/-/g, "_")}`] ||
    process.env[`SWAP_GAS_LIMIT_${c.toUpperCase()}`];
  if (spec) {
    const n = parseInt(spec, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return parseInt(process.env.SWAP_GAS_LIMIT || "320000", 10);
}

async function getWeiEffectiveGasPrice(provider) {
  return withRpcRetry(async () => {
    const fd = await provider.getFeeData();
    if (fd.maxFeePerGas != null && fd.maxFeePerGas > 0n) {
      return fd.maxFeePerGas;
    }
    if (fd.gasPrice != null && fd.gasPrice > 0n) {
      return fd.gasPrice;
    }
    const hex = await provider.send("eth_gasPrice", []);
    return BigInt(hex);
  });
}

/**
 * Lê `fee()` Uniswap V3–style (tier → bps = tier/100).
 * Sem checagem `useRealChainData` — o chamador decide.
 */
async function readV3StylePoolFeeBps(chainSlug, poolAddress) {
  const c = chainSlug.toLowerCase();
  if (c === "solana") return null;
  if (!poolAddress || !/^0x[a-fA-F0-9]{40}$/.test(poolAddress)) return null;

  const prov = getProvider(c);
  if (!prov) return null;

  const key = `${c}|${poolAddress.toLowerCase()}`;
  const hit = feeBpsByChainAddr.get(key);
  if (hit && Date.now() - hit.ts < CACHE_MS * 3) return hit.bps;

  try {
    const contract = new Contract(poolAddress, FEE_ABI, prov);
    const f = await withRpcRetry(() => contract.fee());
    const n = Number(f);
    if (!Number.isFinite(n) || n < 0) return null;
    const bps = n / 100;
    feeBpsByChainAddr.set(key, { ts: Date.now(), bps });
    return bps;
  } catch {
    return null;
  }
}

/** Só para testes — limpa cache de providers após mudar env RPC. */
function clearRpcProviderCacheForTests() {
  providersByKey.clear();
}

module.exports = {
  rpcUrlForChain,
  rpcUrlsForChain,
  hasAnyRpc,
  getProvider,
  gasLimitForChain,
  getWeiEffectiveGasPrice,
  readV3StylePoolFeeBps,
  clearRpcProviderCacheForTests
};
