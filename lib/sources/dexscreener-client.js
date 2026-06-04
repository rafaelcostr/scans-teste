/**
 * Fonte DexScreener: HTTP `latest/dex/pairs` + parse de preço/liquidez.
 * Diagnósticos escrevem-se em `marketDiag.dexscreener`.
 */

const { axiosGetWithCacheAndRetry } = require("../http-resilience");
const { recordDexscreenerPairFetch } = require("../dexscreener-telemetry");

function dexscreenerPairUrl(chain, pairAddress) {
  const c = encodeURIComponent(chain);
  const p = encodeURIComponent(pairAddress);
  return `https://api.dexscreener.com/latest/dex/pairs/${c}/${p}`;
}

/**
 * Parseia o corpo JSON já obtido (útil em testes com fixtures, sem rede).
 * @param {object} body — res.data da API
 * @param {{ name: string, chain: string, pair: string }} pool
 */
function parseDexscreenerPairPayload(body, pool) {
  const pair = body?.pair;
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
  const quoteFetchedAt = new Date().toISOString();
  return { price, liquidityUsd, quoteFetchedAt, baseToken, quoteToken };
}

/**
 * @param {{ axios: import("axios").AxiosInstance }} libs
 * @param {{ chain: string, pair: string, name: string }} pool
 * @param {{ marketId?: string, dexscreener: { requests: number, errors: number, lastError: string | null, cacheHits: number } }} marketDiag
 */
async function fetchDexscreenerPairQuote(libs, pool, marketDiag) {
  const url = dexscreenerPairUrl(pool.chain, pool.pair);
  marketDiag.dexscreener.requests += 1;
  const t0 = Date.now();
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
    recordDexscreenerPairFetch(marketDiag.marketId, Date.now() - t0, false);
    throw e;
  }
  try {
    const out = parseDexscreenerPairPayload(res.data, pool);
    recordDexscreenerPairFetch(marketDiag.marketId, Date.now() - t0, true);
    return out;
  } catch (e) {
    recordDexscreenerPairFetch(marketDiag.marketId, Date.now() - t0, false);
    throw e;
  }
}

module.exports = {
  dexscreenerPairUrl,
  fetchDexscreenerPairQuote,
  parseDexscreenerPairPayload
};
