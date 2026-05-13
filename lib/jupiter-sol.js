/**
 * Round-trip USDC → SOL → USDC via Jupiter v6 (só leitura).
 * Mint USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
 * Mint SOL: So11111111111111111111111111111111111111112
 *
 * Env: ENABLE_JUPITER_SOL=1 (obrigatório para ativar)
 */

const axios = require("axios");
const { axiosGetWithCacheAndRetry } = require("./http-resilience");
const { isWorthwhileNet } = require("./profit-threshold");

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_DECIMALS = 6;

const JUP_BASE =
  process.env.JUPITER_QUOTE_URL || "https://quote-api.jup.ag/v6/quote";

function jupiterEnabled() {
  const e = process.env.ENABLE_JUPITER_SOL;
  return e === "1" || e === "true";
}

async function jupiterQuote(inputMint, outputMint, amount, slippageBps) {
  const q = new URLSearchParams({
    inputMint,
    outputMint,
    amount: String(amount),
    slippageBps: String(slippageBps)
  });
  const url = `${JUP_BASE}?${q.toString()}`;
  const res = await axiosGetWithCacheAndRetry(axios, url, {
    ttlMs: 8000,
    axiosConfig: { timeout: 20000 }
  });
  const out = res.data?.outAmount;
  if (out == null) return null;
  return BigInt(String(out));
}

/**
 * @param {number[]} tableGasLegsUsd
 */
async function tryJupiterSolanaRoundtrip(
  market,
  pools,
  notionalUsd,
  slippageBps,
  defaultFeeBps,
  enrichPoolRowFn,
  tableGasLegsUsd
) {
  if (!jupiterEnabled()) {
    return {
      ok: false,
      code: "SKIP",
      reason: "Jupiter desligado (ENABLE_JUPITER_SOL)."
    };
  }
  if (market.chain.toLowerCase() !== "solana" || market.dynamic) {
    return {
      ok: false,
      code: "SKIP",
      reason: "Só mercados curados Solana."
    };
  }

  const amountUsdc = BigInt(
    Math.round(notionalUsd * 10 ** USDC_DECIMALS)
  );
  if (amountUsdc <= 0n) {
    return { ok: false, code: "SKIP", reason: "Notional inválido." };
  }

  let wSol;
  try {
    wSol = await jupiterQuote(USDC_MINT, SOL_MINT, amountUsdc, slippageBps);
  } catch (e) {
    return {
      ok: false,
      code: "JUPITER_FAIL",
      reason: `Jupiter USDC→SOL: ${e?.message || String(e)}`
    };
  }
  if (wSol == null || wSol === 0n) {
    return {
      ok: false,
      code: "JUPITER_FAIL",
      reason: "Jupiter USDC→SOL sem outAmount."
    };
  }

  let stableBack;
  try {
    stableBack = await jupiterQuote(SOL_MINT, USDC_MINT, wSol, slippageBps);
  } catch (e) {
    return {
      ok: false,
      code: "JUPITER_FAIL",
      reason: `Jupiter SOL→USDC: ${e?.message || String(e)}`
    };
  }
  if (stableBack == null) {
    return {
      ok: false,
      code: "JUPITER_FAIL",
      reason: "Jupiter SOL→USDC sem outAmount."
    };
  }

  const stableHuman = Number(stableBack) / 10 ** USDC_DECIMALS;
  const grossProfitUsd = stableHuman - notionalUsd;
  const spreadPercent =
    notionalUsd > 0 ? ((stableHuman - notionalUsd) / notionalUsd) * 100 : 0;

  const chain = "solana";
  const enriched = await Promise.all(
    pools.map((p) => enrichPoolRowFn(chain, p, defaultFeeBps))
  );

  const solPx = notionalUsd / (Number(wSol) / 1e9);

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
    price: solPx,
    feeBps: enriched[i].feeBps,
    feeSource: enriched[i].feeSource,
    liquidityUsd: null,
    gasUsdTx: enriched[i].gasUsdTx,
    pool,
    priceSource: "jupiter_roundtrip_mid",
    quoteFetchedAt
  }));

  const analysis = {
    marketLabel: market.label,
    chain,
    buyDex: pools[0].name,
    sellDex: pools[1].name,
    buyPrice: solPx,
    sellPrice: solPx,
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
    jupiterRoundtrip: true,
    stableBackHuman: stableHuman,
    collateralSymbol: "USDC",
    quoteFetchedAt,
    note:
      "Round-trip Jupiter USDC↔SOL (agregado). Preços listados ≈ mid; comparar Orca vs Raydium no modo DexScreener."
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

module.exports = { tryJupiterSolanaRoundtrip, jupiterEnabled };
