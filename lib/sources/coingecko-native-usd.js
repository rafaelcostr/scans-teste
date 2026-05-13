/**
 * Fonte CoinGecko: preço USD do ativo nativo mapeado por chain (simple/price).
 */

const axios = require("axios");
const { sleep } = require("../http-resilience");
const scanDiag = require("../scan-diagnostics");

const COINGECKO_ID_BY_CHAIN = {
  arbitrum: "ethereum",
  optimism: "ethereum",
  base: "ethereum",
  ethereum: "ethereum",
  polygon: "matic-network",
  bsc: "binancecoin",
  avalanche: "avalanche-2",
  fantom: "fantom"
};

const KNOWN_EVM_CHAINS = Object.keys(COINGECKO_ID_BY_CHAIN);

const CACHE_MS = parseInt(process.env.REAL_METRICS_CACHE_MS || "20000", 10);

const nativeUsdByCgId = new Map();

/**
 * @param {string} chainSlug
 * @param {{ coingecko?: { errors?: number, lastError?: string | null } } | null | undefined} cgSink
 */
async function fetchNativeUsdForChain(chainSlug, cgSink) {
  const cgId = COINGECKO_ID_BY_CHAIN[chainSlug.toLowerCase()];
  if (!cgId) return null;
  const hit = nativeUsdByCgId.get(cgId);
  if (hit && Date.now() - hit.ts < CACHE_MS) return hit.usd;

  const apiKey = process.env.COINGECKO_API_KEY;
  const base = apiKey
    ? "https://pro-api.coingecko.com/api/v3/simple/price"
    : "https://api.coingecko.com/api/v3/simple/price";
  const url = `${base}?ids=${encodeURIComponent(cgId)}&vs_currencies=usd`;
  const headers = apiKey ? { "x-cg-pro-api-key": apiKey } : {};
  const maxAttempts = 4;
  let lastStatus = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await axios.get(url, {
        timeout: 15000,
        validateStatus: () => true,
        headers: {
          ...headers,
          "User-Agent": "scans-teste/1.0 (coingecko-source)"
        }
      });
      lastStatus = res.status;
      if (res.status === 429) {
        await sleep(Math.min(8000, 400 * 2 ** attempt));
        if (attempt === maxAttempts - 1) {
          scanDiag.cgError(
            "CoinGecko HTTP 429 (rate limit após retries)",
            cgSink
          );
        }
        continue;
      }
      if (res.status >= 500) {
        await sleep(300 * 2 ** attempt);
        if (attempt === maxAttempts - 1) {
          scanDiag.cgError(`CoinGecko HTTP ${res.status} (servidor)`, cgSink);
        }
        continue;
      }
      if (res.status !== 200) {
        scanDiag.cgError(`CoinGecko HTTP ${res.status}`, cgSink);
        return null;
      }
      const usd = res.data?.[cgId]?.usd;
      if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) {
        scanDiag.cgError("CoinGecko: resposta sem USD válido", cgSink);
        return null;
      }
      nativeUsdByCgId.set(cgId, { ts: Date.now(), usd });
      return usd;
    } catch (e) {
      const msg = e?.message || String(e);
      if (attempt === maxAttempts - 1) {
        scanDiag.cgError(`CoinGecko rede: ${msg}`, cgSink);
        return null;
      }
      await sleep(300 * 2 ** attempt);
    }
  }
  scanDiag.cgError(
    `CoinGecko: esgotados retries (último HTTP ${lastStatus})`,
    cgSink
  );
  return null;
}

module.exports = {
  COINGECKO_ID_BY_CHAIN,
  KNOWN_EVM_CHAINS,
  fetchNativeUsdForChain
};
