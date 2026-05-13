/**
 * Fonte DexScreener: HTTP `latest/dex/pairs` + parse de preço/liquidez.
 * Diagnósticos escrevem-se em `marketDiag.dexscreener`.
 */

const { axiosGetWithCacheAndRetry } = require("../http-resilience");

function dexscreenerPairUrl(chain, pairAddress) {
  const c = encodeURIComponent(chain);
  const p = encodeURIComponent(pairAddress);
  return `https://api.dexscreener.com/latest/dex/pairs/${c}/${p}`;
}

/**
 * @param {{ axios: import("axios").AxiosInstance }} libs
 * @param {{ chain: string, pair: string, name: string }} pool
 * @param {{ dexscreener: { requests: number, errors: number, lastError: string | null, cacheHits: number } }} marketDiag
 */
async function fetchDexscreenerPairQuote(libs, pool, marketDiag) {
  const url = dexscreenerPairUrl(pool.chain, pool.pair);
  marketDiag.dexscreener.requests += 1;
  const quoteFetchedAt = new Date().toISOString();
  let res;
  try {
    res = await axiosGetWithCacheAndRetry(libs.axios, url, {
      axiosConfig: {
        timeout: 20000,
        headers: { "User-Agent": "scans-teste/1.0 (dexscreener-source)" }
      }
    });
    if (res.cached) {
      marketDiag.dexscreener.cacheHits =
        (marketDiag.dexscreener.cacheHits || 0) + 1;
    }
  } catch (e) {
    marketDiag.dexscreener.errors += 1;
    marketDiag.dexscreener.lastError = e.message || String(e);
    throw e;
  }
  const pair = res.data?.pair;
  if (!pair || pair.priceUsd == null) {
    throw new Error(`Sem preço: ${pool.name} (${pool.chain}) pair=${pool.pair}`);
  }
  const price = parseFloat(pair.priceUsd);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Preço inválido: ${pool.name} (${pool.chain})`);
  }
  const liqRaw = pair.liquidity?.usd;
  const liquidityUsd =
    typeof liqRaw === "number" && Number.isFinite(liqRaw) ? liqRaw : null;
  const baseToken = pair.baseToken
    ? {
        address: pair.baseToken.address || null,
        symbol: pair.baseToken.symbol || null
      }
    : null;
  const quoteToken = pair.quoteToken
    ? {
        address: pair.quoteToken.address || null,
        symbol: pair.quoteToken.symbol || null
      }
    : null;
  return { price, liquidityUsd, quoteFetchedAt, baseToken, quoteToken };
}

module.exports = {
  dexscreenerPairUrl,
  fetchDexscreenerPairQuote
};
