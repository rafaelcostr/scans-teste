/**
 * Round-trip estável↔base via 1inch ou 0x (só leitura) quando o Quoter curado falha.
 * Suporta: arbitrum, base, bsc (stable único por rede). Polygon multi-USDC: omitido.
 *
 * Env: ENABLE_AGGREGATORS=1, ONEINCH_API_KEY, ZEROX_API_KEY (um ou ambos)
 */

const axios = require("axios");
const { getAddress, parseUnits, formatUnits } = require("ethers");
const { axiosGetWithCacheAndRetry } = require("./http-resilience");
const { isWorthwhileNet } = require("./profit-threshold");

const CHAIN_ID = {
  arbitrum: 42161,
  base: 8453,
  bsc: 56,
  polygon: 137
};

const ZEROX_HOST = {
  arbitrum: "https://arbitrum.api.0x.org",
  base: "https://base.api.0x.org",
  bsc: "https://bsc.api.0x.org",
  polygon: "https://polygon.api.0x.org",
  ethereum: "https://api.0x.org"
};

const TOKENS = {
  arbitrum: {
    base: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    stable: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
    stableDecimals: 6
  },
  base: {
    base: "0x4200000000000000000000000000000000000006",
    stable: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    stableDecimals: 6
  },
  bsc: {
    base: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    stable: "0x55d398326f99059fF775485246999027B3197955",
    stableDecimals: 18
  }
};

function aggregatorsEnabled() {
  const e = process.env.ENABLE_AGGREGATORS;
  if (e !== "1" && e !== "true") return false;
  return (
    Boolean(process.env.ONEINCH_API_KEY) || Boolean(process.env.ZEROX_API_KEY)
  );
}

async function quoteOneInch(chainId, src, dst, amountWei) {
  const key = process.env.ONEINCH_API_KEY;
  if (!key) return null;
  const srcC = getAddress(src);
  const dstC = getAddress(dst);
  const url = `https://api.1inch.dev/swap/v6.0/${chainId}/quote?src=${srcC}&dst=${dstC}&amount=${amountWei.toString()}`;
  try {
    const res = await axiosGetWithCacheAndRetry(axios, url, {
      ttlMs: 12000,
      axiosConfig: {
        timeout: 25000,
        headers: { Authorization: `Bearer ${key}` }
      }
    });
    const amt = res.data?.dstAmount ?? res.data?.toTokenAmount;
    if (amt == null) return null;
    return BigInt(String(amt));
  } catch {
    return null;
  }
}

async function quote0x(chain, sellToken, buyToken, sellAmountWei) {
  const host = ZEROX_HOST[chain.toLowerCase()];
  const key = process.env.ZEROX_API_KEY;
  if (!host) return null;
  const st = getAddress(sellToken);
  const bt = getAddress(buyToken);
  const q = new URLSearchParams({
    sellToken: st,
    buyToken: bt,
    sellAmount: sellAmountWei.toString(),
    skipValidation: "true"
  });
  const url = `${host}/swap/v1/quote?${q.toString()}`;
  try {
    const headers = key ? { "0x-api-key": key } : {};
    const res = await axiosGetWithCacheAndRetry(axios, url, {
      ttlMs: 12000,
      axiosConfig: { timeout: 25000, headers }
    });
    const buy = res.data?.buyAmount;
    if (buy == null) return null;
    return BigInt(String(buy));
  } catch {
    return null;
  }
}

async function quoteStableToBaseAgg(chain, stable, base, amountStableWei) {
  const cid = CHAIN_ID[chain.toLowerCase()];
  if (!cid) return null;
  let out = await quoteOneInch(cid, stable, base, amountStableWei);
  if (out != null) return { out, provider: "1inch" };
  out = await quote0x(chain, stable, base, amountStableWei);
  if (out != null) return { out, provider: "0x" };
  return null;
}

async function quoteBaseToStableAgg(
  chain,
  base,
  stable,
  amountBaseWei,
  providerHint
) {
  const cid = CHAIN_ID[chain.toLowerCase()];
  if (!cid) return null;
  if (providerHint === "1inch") {
    const out = await quoteOneInch(cid, base, stable, amountBaseWei);
    if (out != null) return { out, provider: "1inch" };
  }
  const ox = await quote0x(chain, base, stable, amountBaseWei);
  if (ox != null) return { out: ox, provider: "0x" };
  const inch = await quoteOneInch(cid, base, stable, amountBaseWei);
  if (inch != null) return { out: inch, provider: "1inch" };
  return null;
}

/**
 * Round-trip agregador (mesmo notional estável) para redes suportadas.
 */
async function tryAggregatorRoundtrip(
  market,
  pools,
  notionalUsd,
  slippageBps,
  defaultFeeBps,
  enrichPoolRowFn,
  tableGasLegsUsd
) {
  if (!aggregatorsEnabled()) {
    return {
      ok: false,
      code: "SKIP",
      reason: "Agregadores desligados ou sem API key."
    };
  }
  const chain = market.chain.toLowerCase();
  if (chain === "polygon") {
    return {
      ok: false,
      code: "SKIP_POLYGON",
      reason: "Polygon (dois USDC): use Quoter curado ou DexScreener."
    };
  }
  const t = TOKENS[chain];
  if (!t) {
    return {
      ok: false,
      code: "SKIP",
      reason: `Rede ${chain} sem mapa agregador.`
    };
  }

  const amountInStable = parseUnits(
    notionalUsd.toFixed(t.stableDecimals > 8 ? 8 : t.stableDecimals),
    t.stableDecimals
  );

  const q1 = await quoteStableToBaseAgg(chain, t.stable, t.base, amountInStable);
  if (!q1) {
    return {
      ok: false,
      code: "AGG_QUOTE_FAIL",
      reason: "1inch/0x: quote estável→base sem resultado."
    };
  }

  const wOut = q1.out;
  const wHuman = Number(formatUnits(wOut, 18));
  if (!Number.isFinite(wHuman) || wHuman <= 0) {
    return {
      ok: false,
      code: "AGG_QUOTE_FAIL",
      reason: "Quote agregador inválida (base)."
    };
  }
  const px = notionalUsd / wHuman;

  const q2 = await quoteBaseToStableAgg(
    chain,
    t.base,
    t.stable,
    wOut,
    q1.provider
  );
  if (!q2) {
    return {
      ok: false,
      code: "AGG_QUOTE_FAIL",
      reason: "1inch/0x: quote base→estável sem resultado."
    };
  }

  const stableHuman = Number(formatUnits(q2.out, t.stableDecimals));
  const grossProfitUsd = stableHuman - notionalUsd;
  const spreadPercent =
    notionalUsd > 0 ? ((stableHuman - notionalUsd) / notionalUsd) * 100 : 0;

  const enriched = await Promise.all(
    pools.map((p) => enrichPoolRowFn(chain, p, defaultFeeBps))
  );

  const gasCostUsd = (tableGasLegsUsd[0] ?? 0) + (tableGasLegsUsd[1] ?? 0);
  const gasSource = "table";
  const slippageUsd = (notionalUsd * slippageBps) / 10000;
  const buyFeeBps = enriched[0].feeBps;
  const sellFeeBps = enriched[1].feeBps;
  const poolFeesUsd = (notionalUsd * (buyFeeBps + sellFeeBps)) / 10000;
  const netProfitUsd = grossProfitUsd - gasCostUsd - slippageUsd - poolFeesUsd;
  const worthwhile = isWorthwhileNet(netProfitUsd);

  const quoteFetchedAt = new Date().toISOString();

  const rows = pools.map((pool, i) => ({
    dex: pool.name,
    chain,
    price: px,
    feeBps: enriched[i].feeBps,
    feeSource: enriched[i].feeSource,
    liquidityUsd: null,
    gasUsdTx: enriched[i].gasUsdTx,
    pool,
    priceSource: `aggregator_ref_${q2.provider}`,
    quoteFetchedAt
  }));

  const analysis = {
    marketLabel: market.label,
    chain,
    buyDex: pools[0].name,
    sellDex: pools[1].name,
    buyPrice: px,
    sellPrice: px,
    buyFeeBps,
    sellFeeBps,
    buyFeeSource: enriched[0].feeSource,
    sellFeeSource: enriched[1].feeSource,
    spreadPercent,
    grossProfitUsd,
    gasCostUsd,
    gasSource,
    slippageUsd,
    slippageMode: "bps_on_notional",
    poolFeesUsd,
    costsUsd: gasCostUsd + slippageUsd + poolFeesUsd,
    netProfitUsd,
    worthwhile,
    onChainRoundtrip: true,
    aggregatorRoundtrip: true,
    aggregatorProvider: q2.provider,
    aggregatorLegProvider: q1.provider,
    stableBackHuman: stableHuman,
    collateralSymbol: chain === "bsc" ? "USDT" : "USDC",
    quoteFetchedAt,
    note:
      "Round-trip via agregador (1inch/0x). Preços listados = mesmo mid de referência; comparar venues continua a usar DexScreener no modo modelo."
  };

  return {
    ok: true,
    prices: rows.map((r) => ({
      dex: r.dex,
      price: r.price,
      feeBps: r.feeBps,
      feeSource: r.feeSource,
      priceSource: r.priceSource,
      quoteFetchedAt: r.quoteFetchedAt
    })),
    rows,
    analysis
  };
}

module.exports = { tryAggregatorRoundtrip, aggregatorsEnabled };
