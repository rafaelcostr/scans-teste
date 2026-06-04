/**
 * Simulação on-chain para mercados curados (pares do projeto):
 * quote estável → base e base → estável; round-trip USDC→WETH→USDC (ou USDT↔WBNB na BSC);
 * gas com estimateGas nos routers V3 quando possível.
 * Solana e mercados dinâmicos: não cobertos.
 */

const {
  Contract,
  Interface,
  getAddress,
  parseUnits,
  formatUnits
} = require("ethers");
const axios = require("axios");
const { axiosGetWithCacheAndRetry } = require("./http-resilience");
const { getProvider, estimateTxGasUsd } = require("./chain-metrics");
const { withRpcRetry } = require("./rpc-resilience");
const { isWorthwhileNet } = require("./profit-threshold");
const { getQuoteSimBlockOverrides } = require("./quote-sim-options");

const DISABLE =
  process.env.DISABLE_CURATED_ONCHAIN_QUOTES === "1" ||
  process.env.DISABLE_CURATED_ONCHAIN_QUOTES === "true";

const SIM_FROM =
  process.env.QUOTE_SIM_FROM || "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

const CHAIN_ID = {
  arbitrum: 42161,
  base: 8453,
  polygon: 137,
  bsc: 56
};

const UNIV3_PERIPHERY = {
  42161: {
    quoterV2: "0x61fFE014bA17989E743c25F442bEa42611667489",
    swapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"
  },
  8453: {
    quoterV2: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
    swapRouter02: "0x2626664c2603336E57B271c5C0b26F421741e481"
  },
  137: {
    quoterV2: "0x61fFE014bA17989E743c25F442bEa42611667489",
    swapRouter02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"
  }
};

const PANCAKE_BSC = {
  quoterV2: "0xB048Bbc1Ee6b733FfEdFB8A8371813ff1c8D965d",
  swapRouter: "0x1b81D49Ff273b5E3d96C274314D4Ed7b877Eabc7"
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
  polygon: {
    base: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    stableDecimals: 6
  },
  bsc: {
    base: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    stable: "0x55d398326f99059fF775485246999027B3197955",
    stableDecimals: 18
  }
};

const POOL_ENGINE = {
  arbitrum: {
    "0xc31e54c7a869b9fcbecc14363cf510d1c41fa443": "univ3",
    "0x905dfcd5649217c42684f23958568e533c711aa3": "univ2"
  },
  base: {
    "0xb2cc224c1c9fee385f8ad6a55b4d94e92359dc59": "aerodrome",
    "0xd0b53d9277642d899df5c87a3966a349a798f224": "univ3"
  },
  polygon: {
    "0x45dda9cb7c25131df268515131f647d726f50608": "univ3",
    "0xa4d8c89f0c20efbe54cba9e7e7a7e509056228d9": "univ3",
    "0x0e44ceb592acfc5d3f09d996302eb4c499ff8c10": "univ3",
    "0x853ee4b2a13f8a742d64c8f088be7ba2131f670d": "univ2",
    "0x34965ba0ac2451a34a0471f04cca3f990b8dea27": "univ2"
  },
  bsc: {
    "0x172fcd41e0913e95784454622d1c3724f546f849": "pancakev3",
    "0x8840c6252e2e86e545defb6da98b2a0e26d8c1ba": "univ2"
  }
};

const POOL_V3_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)"
];

const POOL_V2_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
];

const AERO_POOL_ABI = [
  ...POOL_V2_ABI,
  "function getAmountOut(uint256 amountIn, address tokenIn) view returns (uint256)"
];

const QUOTER_V2_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"
];

const ROUTER02_ABI = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)"
];

function dexscreenerPairUrl(chain, pairAddress) {
  return `https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(chain)}/${encodeURIComponent(pairAddress)}`;
}

async function fetchDexLiquidity(chain, pair, dexSink) {
  try {
    const url = dexscreenerPairUrl(chain, pair);
    const res = await axiosGetWithCacheAndRetry(axios, url, {
      ttlMs: parseInt(process.env.DEXSCREENER_CACHE_MS || "15000", 10)
    });
    const liq = res.data?.pair?.liquidity?.usd;
    return typeof liq === "number" && Number.isFinite(liq) ? liq : null;
  } catch (e) {
    if (dexSink?.dexscreener) {
      dexSink.dexscreener.errors += 1;
      dexSink.dexscreener.lastError = e?.message || String(e);
    }
    return null;
  }
}

function normAddr(a) {
  try {
    return getAddress(a).toLowerCase();
  } catch {
    return String(a).toLowerCase();
  }
}

function stableAddrForPolygonPool(poolLower) {
  if (poolLower.includes("45dda9")) {
    return "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
  }
  if (poolLower.includes("a4d8c8")) {
    return "0x3c499c542cEF5E3811e1192ce70d8cC03e5e3342";
  }
  return "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
}

function collateralForMarket(chain) {
  const c = chain.toLowerCase();
  if (c === "arbitrum") {
    const t = TOKENS.arbitrum;
    return {
      symbol: "USDC",
      stable: t.stable,
      stableDecimals: t.stableDecimals,
      base: t.base,
      baseDecimals: 18,
      polygonPerPool: false
    };
  }
  if (c === "base") {
    const t = TOKENS.base;
    return {
      symbol: "USDC",
      stable: t.stable,
      stableDecimals: t.stableDecimals,
      base: t.base,
      baseDecimals: 18,
      polygonPerPool: false
    };
  }
  if (c === "polygon") {
    const t = TOKENS.polygon;
    return {
      symbol: "USDC",
      stable: null,
      stableDecimals: t.stableDecimals,
      base: t.base,
      baseDecimals: 18,
      polygonPerPool: true
    };
  }
  if (c === "bsc") {
    const t = TOKENS.bsc;
    return {
      symbol: "USDT",
      stable: t.stable,
      stableDecimals: t.stableDecimals,
      base: t.base,
      baseDecimals: 18,
      polygonPerPool: false
    };
  }
  return null;
}

function stableForPool(collateral, poolLower) {
  if (collateral.polygonPerPool) return stableAddrForPolygonPool(poolLower);
  return collateral.stable;
}

function getAmountOutV2(amountIn, reserveIn, reserveOut) {
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  return numerator / denominator;
}

async function quoteV2Pair(provider, poolAddr, tokenIn, tokenOut, amountIn) {
  const ov = getQuoteSimBlockOverrides();
  const useOv = ov && Object.keys(ov).length > 0;
  const p = new Contract(poolAddr, POOL_V2_ABI, provider);
  const [t0, t1, res] = useOv
    ? await Promise.all([p.token0(ov), p.token1(ov), p.getReserves(ov)])
    : await Promise.all([p.token0(), p.token1(), p.getReserves()]);
  const r0 = BigInt(res.reserve0.toString());
  const r1 = BigInt(res.reserve1.toString());
  const in0 = normAddr(tokenIn) === normAddr(t0);
  const reserveIn = in0 ? r0 : r1;
  const reserveOut = in0 ? r1 : r0;
  if (reserveIn === 0n || reserveOut === 0n) return null;
  return getAmountOutV2(amountIn, reserveIn, reserveOut);
}

async function quoteV3Single(provider, quoterAddr, tokenIn, tokenOut, fee, amountIn) {
  const q = new Contract(quoterAddr, QUOTER_V2_ABI, provider);
  const params = {
    tokenIn,
    tokenOut,
    fee: Number(fee),
    amountIn,
    sqrtPriceLimitX96: 0
  };
  const ov = getQuoteSimBlockOverrides();
  const out =
    ov && Object.keys(ov).length > 0
      ? await q.quoteExactInputSingle.staticCall(params, ov)
      : await q.quoteExactInputSingle.staticCall(params);
  const amountOut = out.amountOut ?? out[0];
  return BigInt(amountOut.toString());
}

async function quoteAerodromePool(provider, poolAddr, tokenIn, amountIn) {
  const p = new Contract(poolAddr, AERO_POOL_ABI, provider);
  const ov = getQuoteSimBlockOverrides();
  try {
    const out =
      ov && Object.keys(ov).length > 0
        ? await p.getAmountOut(amountIn, tokenIn, ov)
        : await p.getAmountOut(amountIn, tokenIn);
    return BigInt(out.toString());
  } catch {
    return null;
  }
}

function quoterAddrFor(chain, engine) {
  if (engine === "pancakev3") return PANCAKE_BSC.quoterV2;
  const cid = CHAIN_ID[chain.toLowerCase()];
  return UNIV3_PERIPHERY[cid]?.quoterV2 ?? null;
}

async function quoteStableToBase(provider, chain, poolAddr, engine, collateral, amountInStable) {
  const poolL = normAddr(poolAddr);
  const stableAddr = stableForPool(collateral, poolL);
  const baseAddr = collateral.base;

  if (engine === "univ2") {
    return quoteV2Pair(provider, poolAddr, stableAddr, baseAddr, amountInStable);
  }
  if (engine === "aerodrome") {
    return quoteAerodromePool(provider, poolAddr, stableAddr, amountInStable);
  }

  const p = new Contract(poolAddr, POOL_V3_ABI, provider);
  const ov = getQuoteSimBlockOverrides();
  const useOv = ov && Object.keys(ov).length > 0;
  const [t0, t1, fee] = useOv
    ? await Promise.all([p.token0(ov), p.token1(ov), p.fee(ov)])
    : await Promise.all([p.token0(), p.token1(), p.fee()]);
  const n0 = normAddr(t0);
  const n1 = normAddr(t1);
  const ns = normAddr(stableAddr);
  const nb = normAddr(baseAddr);
  if ((n0 !== ns && n1 !== ns) || (n0 !== nb && n1 !== nb)) return null;

  const qAddr = quoterAddrFor(chain, engine);
  if (!qAddr) return null;
  return quoteV3Single(provider, qAddr, stableAddr, baseAddr, fee, amountInStable);
}

async function quoteBaseToStable(provider, chain, poolAddr, engine, collateral, amountInBase) {
  const poolL = normAddr(poolAddr);
  const stableAddr = stableForPool(collateral, poolL);
  const baseAddr = collateral.base;

  if (engine === "univ2") {
    return quoteV2Pair(provider, poolAddr, baseAddr, stableAddr, amountInBase);
  }
  if (engine === "aerodrome") {
    return quoteAerodromePool(provider, poolAddr, baseAddr, amountInBase);
  }

  const p = new Contract(poolAddr, POOL_V3_ABI, provider);
  const ov = getQuoteSimBlockOverrides();
  const useOv = ov && Object.keys(ov).length > 0;
  const [t0, t1, fee] = useOv
    ? await Promise.all([p.token0(ov), p.token1(ov), p.fee(ov)])
    : await Promise.all([p.token0(), p.token1(), p.fee()]);
  const n0 = normAddr(t0);
  const n1 = normAddr(t1);
  const ns = normAddr(stableAddr);
  const nb = normAddr(baseAddr);
  if ((n0 !== ns && n1 !== ns) || (n0 !== nb && n1 !== nb)) return null;

  const qAddr = quoterAddrFor(chain, engine);
  if (!qAddr) return null;
  return quoteV3Single(provider, qAddr, baseAddr, stableAddr, fee, amountInBase);
}

function encodeRouterExactInputSingle(routerIface, tokenIn, tokenOut, fee, recipient, amountIn) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  return routerIface.encodeFunctionData("exactInputSingle", [
    {
      tokenIn,
      tokenOut,
      fee: Number(fee),
      recipient,
      deadline,
      amountIn,
      amountOutMinimum: 0n,
      sqrtPriceLimitX96: 0
    }
  ]);
}

async function estimateGasUsdV3Swap(
  provider,
  chain,
  engine,
  tokenIn,
  tokenOut,
  fee,
  amountIn,
  cgSink
) {
  let routerAddr;
  if (chain.toLowerCase() === "bsc" && engine === "pancakev3") {
    routerAddr = PANCAKE_BSC.swapRouter;
  } else {
    const cid = CHAIN_ID[chain.toLowerCase()];
    routerAddr = UNIV3_PERIPHERY[cid]?.swapRouter02;
  }
  if (!routerAddr) return null;
  const iface = new Interface(ROUTER02_ABI);
  const data = encodeRouterExactInputSingle(
    iface,
    tokenIn,
    tokenOut,
    fee,
    SIM_FROM,
    amountIn
  );
  return estimateTxGasUsd(
    chain.toLowerCase(),
    {
      to: routerAddr,
      data,
      from: SIM_FROM
    },
    cgSink
  );
}

async function tryGasV3Leg(
  provider,
  chain,
  poolAddr,
  engine,
  collateral,
  stableToBase,
  amountIn,
  simOptions
) {
  if (simOptions?.testHooks?.skipGasEstimate) return null;
  if (engine === "univ2" || engine === "aerodrome") return null;
  const poolL = normAddr(poolAddr);
  const stableAddr = stableForPool(collateral, poolL);
  const baseAddr = collateral.base;
  const p = new Contract(poolAddr, POOL_V3_ABI, provider);
  const ov = getQuoteSimBlockOverrides();
  const useOv = ov && Object.keys(ov).length > 0;
  const fee = useOv ? await p.fee(ov) : await p.fee();
  const tokenIn = stableToBase ? stableAddr : baseAddr;
  const tokenOut = stableToBase ? baseAddr : stableAddr;
  const cgSink = simOptions?.marketDiag ?? null;
  return estimateGasUsdV3Swap(
    provider,
    chain,
    engine,
    tokenIn,
    tokenOut,
    fee,
    amountIn,
    cgSink
  );
}

/**
 * @param {number[]} tableGasLegsUsd - fallback 2 pernas (gas tabela) do scanner
 * @param {object} [simOptions]
 * @param {(slug: string) => import("ethers").Provider | null} [simOptions.getProvider]
 * @param {{ marketId?: string, dexscreener?: object, coingecko?: object }} [simOptions.marketDiag] — diagnóstico Dex/CG deste mercado (preenchido pelo scanner)
 * @param {object} [simOptions.testHooks] — só testes: `quoteStableToBase`, `quoteBaseToStable`, `skipGasEstimate`
 */
async function tryCuratedOnChainRoundtrip(
  market,
  pools,
  notionalUsd,
  slippageBps,
  defaultFeeBps,
  enrichPoolRowFn,
  tableGasLegsUsd,
  simOptions = {}
) {
  try {
    return await runCuratedOnChainRoundtrip(
      market,
      pools,
      notionalUsd,
      slippageBps,
      defaultFeeBps,
      enrichPoolRowFn,
      tableGasLegsUsd,
      simOptions
    );
  } catch (e) {
    const msg =
      e?.shortMessage || e?.reason || e?.message || String(e);
    return {
      ok: false,
      code: "EXCEPTION",
      reason: `Exceção na simulação on-chain: ${msg}`
    };
  }
}

async function runCuratedOnChainRoundtrip(
  market,
  pools,
  notionalUsd,
  slippageBps,
  defaultFeeBps,
  enrichPoolRowFn,
  tableGasLegsUsd,
  simOptions = {}
) {
  const getProv =
    typeof simOptions.getProvider === "function"
      ? simOptions.getProvider
      : getProvider;
  const rpcRetry =
    typeof simOptions.rpcRetry === "function" ? simOptions.rpcRetry : withRpcRetry;

  if (DISABLE) {
    return {
      ok: false,
      code: "DISABLE",
      reason: "Quotes on-chain curados desativados (DISABLE_CURATED_ONCHAIN_QUOTES)."
    };
  }
  const chain = market.chain.toLowerCase();
  if (chain === "solana" || market.dynamic) {
    return {
      ok: false,
      code: "SKIP",
      reason: "Solana ou mercado dinâmico: sem motor on-chain curado."
    };
  }

  const provider = getProv(chain);
  if (!provider) {
    return {
      ok: false,
      code: "NO_RPC",
      reason: `Sem RPC configurado para ${chain} (defina RPC_${chain.toUpperCase()} ou RPC_URLS_JSON).`
    };
  }

  const collateral = collateralForMarket(chain);
  if (!collateral) {
    return {
      ok: false,
      code: "NO_COLLATERAL",
      reason: `Rede ${chain} sem colateral estável mapeado no simulador.`
    };
  }

  const engines = POOL_ENGINE[chain];
  if (!engines) {
    return {
      ok: false,
      code: "NO_ENGINES",
      reason: `Rede ${chain} sem POOL_ENGINE no simulador.`
    };
  }

  const amountInStable = parseUnits(
    notionalUsd.toFixed(collateral.stableDecimals > 8 ? 8 : collateral.stableDecimals),
    collateral.stableDecimals
  );

  const perPool = [];
  for (const pool of pools) {
    const pl = normAddr(pool.pair);
    const engine = engines[pl];
    if (!engine) {
      return {
        ok: false,
        code: "UNKNOWN_POOL",
        reason: `Pool não mapeado no motor on-chain: ${pool.name} (${pool.pair}).`
      };
    }
    let wOut;
    try {
      if (simOptions?.testHooks?.quoteStableToBase) {
        wOut = await simOptions.testHooks.quoteStableToBase({
          provider,
          chain,
          pool,
          pl,
          engine,
          collateral,
          amountInStable
        });
      } else {
        wOut = await rpcRetry(() =>
          quoteStableToBase(
            provider,
            chain,
            pool.pair,
            engine,
            collateral,
            amountInStable
          )
        );
      }
    } catch (e) {
      const msg = e?.shortMessage || e?.reason || e?.message || String(e);
      return {
        ok: false,
        code: "QUOTE_STABLE_TO_BASE",
        reason: `Quote estável→base falhou (${pool.name}): ${msg}`
      };
    }
    if (wOut == null || wOut === 0n) {
      return {
        ok: false,
        code: "QUOTE_STABLE_TO_BASE",
        reason: `Quote estável→base sem saída (${pool.name}).`
      };
    }
    const wHuman = Number(formatUnits(wOut, collateral.baseDecimals));
    if (!Number.isFinite(wHuman) || wHuman <= 0) {
      return {
        ok: false,
        code: "QUOTE_STABLE_TO_BASE",
        reason: `Quote estável→base inválida (${pool.name}).`
      };
    }
    const px = notionalUsd / wHuman;
    perPool.push({ pool, engine, pl, wOut, wHuman, price: px });
  }

  const buyI = perPool[0].wOut >= perPool[1].wOut ? 0 : 1;
  const sellI = 1 - buyI;
  const wStar = perPool[buyI].wOut;

  let stableBack;
  try {
    if (simOptions?.testHooks?.quoteBaseToStable) {
      stableBack = await simOptions.testHooks.quoteBaseToStable({
        provider,
        chain,
        sellPool: perPool[sellI].pool,
        sellEngine: perPool[sellI].engine,
        collateral,
        wStar,
        buyIndex: buyI,
        sellIndex: sellI
      });
    } else {
      stableBack = await rpcRetry(() =>
        quoteBaseToStable(
          provider,
          chain,
          perPool[sellI].pool.pair,
          perPool[sellI].engine,
          collateral,
          wStar
        )
      );
    }
  } catch (e) {
    const msg = e?.shortMessage || e?.reason || e?.message || String(e);
    return {
      ok: false,
      code: "QUOTE_BASE_TO_STABLE",
      reason: `Quote base→estável falhou na perna de venda (${perPool[sellI].pool.name}): ${msg}`
    };
  }
  if (stableBack == null) {
    return {
      ok: false,
      code: "QUOTE_BASE_TO_STABLE",
      reason: `Quote base→estável sem saída (${perPool[sellI].pool.name}).`
    };
  }

  const stableHuman = Number(
    formatUnits(stableBack, collateral.stableDecimals)
  );
  const grossProfitUsd = stableHuman - notionalUsd;
  const spreadPercent =
    notionalUsd > 0 ? ((stableHuman - notionalUsd) / notionalUsd) * 100 : 0;

  const enriched = await Promise.all(
    pools.map((p) => enrichPoolRowFn(chain, p, defaultFeeBps))
  );

  let gasLegBuy = null;
  let gasLegSell = null;
  try {
    gasLegBuy = await tryGasV3Leg(
      provider,
      chain,
      perPool[buyI].pool.pair,
      perPool[buyI].engine,
      collateral,
      true,
      amountInStable,
      simOptions
    );
    gasLegSell = await tryGasV3Leg(
      provider,
      chain,
      perPool[sellI].pool.pair,
      perPool[sellI].engine,
      collateral,
      false,
      wStar,
      simOptions
    );
  } catch {
    /* ignore */
  }

  const gasRpcSum =
    gasLegBuy != null && gasLegSell != null ? gasLegBuy + gasLegSell : null;

  const liqs = await Promise.all(
    pools.map((p) => fetchDexLiquidity(chain, p.pair, simOptions.marketDiag))
  );

  const poolFeesUsd = 0;
  const slippageUsd = (notionalUsd * slippageBps) / 10000;

  let gasCostUsd;
  let gasSource;
  if (gasRpcSum != null) {
    gasCostUsd = gasRpcSum;
    gasSource = "rpc_estimateGas";
  } else {
    gasCostUsd = (tableGasLegsUsd[0] ?? 0) + (tableGasLegsUsd[1] ?? 0);
    gasSource =
      enriched[0].gasUsdTx != null || enriched[1].gasUsdTx != null
        ? "rpc_swap_limit_x2"
        : "table";
  }

  const netProfitUsd = grossProfitUsd - gasCostUsd - slippageUsd - poolFeesUsd;
  const worthwhile = isWorthwhileNet(netProfitUsd);

  const quoteFetchedAt = new Date().toISOString();

  const rows = pools.map((pool, i) => ({
    dex: pool.name,
    chain,
    price: perPool[i].price,
    feeBps: enriched[i].feeBps,
    feeSource: enriched[i].feeSource,
    liquidityUsd: liqs[i],
    gasUsdTx: enriched[i].gasUsdTx,
    pool,
    priceSource: "onchain_quote_stable_to_base",
    onChainEngine: perPool[i].engine,
    quoteFetchedAt
  }));

  const analysis = {
    marketLabel: market.label,
    chain,
    buyDex: perPool[buyI].pool.name,
    sellDex: perPool[sellI].pool.name,
    buyPrice: perPool[buyI].price,
    sellPrice: perPool[sellI].price,
    buyFeeBps: enriched[buyI].feeBps,
    sellFeeBps: enriched[sellI].feeBps,
    buyFeeSource: enriched[buyI].feeSource,
    sellFeeSource: enriched[sellI].feeSource,
    spreadPercent,
    grossProfitUsd,
    gasCostUsd,
    gasSource,
    slippageUsd,
    slippageMode: "bps_on_notional",
    poolFeesUsd,
    feesIncludedInQuote: true,
    costsUsd: gasCostUsd + slippageUsd + poolFeesUsd,
    netProfitUsd,
    worthwhile,
    onChainRoundtrip: true,
    stableBackHuman: stableHuman,
    collateralSymbol: collateral.symbol,
    quoteFetchedAt
  };

  return {
    ok: true,
    prices: rows.map((r) => ({
      dex: r.dex,
      price: r.price,
      feeBps: r.feeBps,
      feeSource: r.feeSource,
      priceSource: r.priceSource,
      engine: r.onChainEngine,
      quoteFetchedAt: r.quoteFetchedAt
    })),
    rows,
    analysis
  };
}

module.exports = {
  tryCuratedOnChainRoundtrip,
  POOL_ENGINE
};
