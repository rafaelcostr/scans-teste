const axios = require("axios");
const {
  buildDynamicMarkets,
  loadSeedByChain
} = require("./lib/dynamic-markets");
const {
  enrichPoolRow,
  useRealChainData,
  getRealDataSummary,
  rpcUrlForChain
} = require("./lib/chain-metrics");
const { tryCuratedOnChainRoundtrip } = require("./lib/curated-onchain-sim");
const {
  tryAggregatorRoundtrip,
  aggregatorsEnabled
} = require("./lib/aggregator-roundtrip");
const {
  tryJupiterSolanaRoundtrip,
  jupiterEnabled
} = require("./lib/jupiter-sol");
const { axiosGetWithCacheAndRetry } = require("./lib/http-resilience");
const { fetchDexscreenerPairQuote } = require("./lib/sources/dexscreener-client");
const { collectModelStableWarnings } = require("./lib/stable-model-warnings");
const { minNetProfitUsd, isWorthwhileNet } = require("./lib/profit-threshold");
const {
  applyWorthwhileGates,
  dynamicMinLiquidityUsd,
  minSpreadPercent
} = require("./lib/scan-quality");
const { buildIntentsFromScan } = require("./lib/scan-intents");
const { buildHistoryNoiseMap } = require("./lib/scan-history-noise");
const scanDiag = require("./lib/scan-diagnostics");

const resilientAxios = {
  get: (url, config = {}) =>
    axiosGetWithCacheAndRetry(axios, url, { axiosConfig: config })
};

/** Valor fictício da operação em USD por mercado (cada mercado é uma rede). Override: NOTIONAL_USD. */
const NOTIONAL_USD = parseFloat(process.env.NOTIONAL_USD || "200");

/** Até N mercados montados via DexScreener + `data/seed-tokens.json`. */
const MAX_DYNAMIC_MARKETS = parseInt(
  process.env.MAX_DYNAMIC_MARKETS || "200",
  10
);
const DISABLE_DYNAMIC =
  process.env.DISABLE_DYNAMIC === "1" ||
  process.env.DISABLE_DYNAMIC === "true";
const DYNAMIC_CACHE_MS = parseInt(
  process.env.DYNAMIC_CACHE_MS || "300000",
  10
);

let dynamicTemplatesCache = { ts: 0, list: [] };

/** Slippage estimado como fração do notional (basis points). */
const SLIPPAGE_BPS = parseInt(process.env.SLIPPAGE_BPS || "20", 10);

/** Concorrência máxima de pedidos DexScreener por mercado (fila leve). */
const DEXSCREENER_CONCURRENCY = parseInt(
  process.env.DEXSCREENER_CONCURRENCY || "4",
  10
);

/**
 * Taxa de swap padrão (bps) quando o pool não tem `feeBps`.
 * Uniswap V3: leia o fee tier no contrato do pool — tier 500 = 5 bps, 3000 = 30, 10000 = 100.
 */
const DEFAULT_SWAP_FEE_BPS = parseInt(
  process.env.DEFAULT_SWAP_FEE_BPS || "30",
  10
);

/**
 * Gas médio estimado por chain (USD). Ajuste conforme a rede.
 * Em cada pool você pode definir `gasCostUsd` para sobrescrever.
 */
const GAS_COST_USD_BY_CHAIN = {
  ethereum: 4,
  arbitrum: 0.15,
  optimism: 0.12,
  base: 0.12,
  polygon: 0.05,
  bsc: 0.25,
  avalanche: 0.12,
  fantom: 0.03,
  solana: 0.03
};

const DEFAULT_GAS_COST_USD = 1;

/**
 * Lista curada: cada mercado = mesmo ativo lógico na MESMA rede, vários DEX.
 * - `id`: chave estável (relatórios / logs).
 * - `chain`: slug DexScreener (ex.: bsc = BNB Chain).
 * - `disabled`: se true, não consulta API (use `setupNote` + preencha pools).
 * - `pools`: { name, pair, feeBps?, gasCostUsd? } — `pair` = endereço no DexScreener.
 *   `feeBps` = taxa de swap do pool em basis points (ex.: Uniswap V3 tier 3000 → 30 bps;
 *   tier 500 → 5 bps). Se omitido, usa DEFAULT_SWAP_FEE_BPS (env ou 30).
 *   `gasCostUsd` = custo de gas em USD para 1 swap nesse pool (sobrescreve a tabela por chain).
 *
 * Polygon: vários DEX (QuickSwap, Sushi, Uniswap fee 0.05%/0.30%). USDC.e (PoS)
 * vs USDC nativo são contratos diferentes — trate spreads como estudo, não como
 * arb “limpo” entre stables distintas.
 */
const CURATED_MARKETS = [
  {
    id: "arb-weth-usdc",
    label: "WETH / USDC",
    chain: "arbitrum",
    pools: [
      {
        name: "Uniswap V3",
        pair: "0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443",
        feeBps: 5
      },
      {
        name: "SushiSwap",
        pair: "0x905dfCD5649217c42684f23958568e533C711Aa3",
        feeBps: 30
      }
    ]
  },
  {
    id: "base-weth-usdc",
    label: "WETH / USDC",
    chain: "base",
    pools: [
      {
        name: "Aerodrome",
        pair: "0xb2cc224c1c9feE385f8ad6a55b4d94E92359DC59",
        feeBps: 30
      },
      {
        name: "Uniswap V3",
        pair: "0xd0b53D9277642d899DF5C87A3966A349A798F224",
        feeBps: 5
      }
    ]
  },
  {
    id: "pol-weth-usdc",
    label: "WETH / USDC (Polygon — vários DEX)",
    chain: "polygon",
    note:
      "QuickSwap V2, SushiSwap e Uniswap V3 (USDC.e 0.05% / 0.30% + USDC nativo). Spreads podem misturar diferença de stable com diferença de DEX.",
    pools: [
      {
        name: "QuickSwap V2",
        pair: "0x853Ee4b2A13f8a742d64C8F088bE7bA2131f670d",
        feeBps: 30
      },
      {
        name: "SushiSwap",
        pair: "0x34965ba0ac2451A34a0471F04CCa3F990b8dea27",
        feeBps: 30
      },
      {
        name: "Uniswap V3 (USDC.e 0.05%)",
        pair: "0x45dDa9cb7c25131DF268515131f647d726f50608",
        feeBps: 5
      },
      {
        name: "Uniswap V3 (USDC.e 0.30%)",
        pair: "0x0e44cEb592AcFC5D3F09D996302eB4C499ff8c10",
        feeBps: 30
      },
      {
        name: "Uniswap V3 (USDC nativo)",
        pair: "0xA4D8c89f0c20efbe54cBa9e7e7a7E509056228D9",
        feeBps: 5
      }
    ]
  },
  {
    id: "bsc-wbnb-usdt",
    label: "WBNB / USDT",
    chain: "bsc",
    pools: [
      {
        name: "PancakeSwap V3",
        pair: "0x172fcD41E0913e95784454622d1c3724f546f849",
        feeBps: 5
      },
      {
        name: "Biswap",
        pair: "0x8840C6252e2e86e545deFb6da98B2a0E26d8C1BA",
        feeBps: 20
      }
    ]
  },
  {
    id: "sol-sol-usdc",
    label: "SOL / USDC",
    chain: "solana",
    pools: [
      {
        name: "Orca",
        pair: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
        feeBps: 30
      },
      {
        name: "Raydium CLMM",
        pair: "2QdhepnKRTLjjSqPL1PtKNwqrUkoLee5Gqs8bvZhRdMv",
        feeBps: 30
      }
    ]
  },
  {
    id: "op-weth-usdc",
    label: "WETH / USDC",
    chain: "optimism",
    disabled: true,
    setupNote:
      "Ative após colar 2+ endereços de par WETH/USDC (ou equivalente) desta rede, copiados do DexScreener. Slug da API: optimism.",
    pools: []
  },
  {
    id: "avax-weth-usdc",
    label: "WETH.e / USDC (ou AVAX/USDC)",
    chain: "avalanche",
    disabled: true,
    setupNote:
      "Ative após colar 2+ pools na Avalanche C-Chain. Slug da API: avalanche.",
    pools: []
  },
  {
    id: "ftm-weth-usdc",
    label: "WETH / USDC (Fantom)",
    chain: "fantom",
    disabled: true,
    setupNote:
      "Fantom tem liquidez menor hoje; confirme pares ativos no DexScreener. Slug: fantom.",
    pools: []
  }
];

function gasCostUsdForPool(pool, chainFallback) {
  if (
    pool &&
    typeof pool.gasCostUsd === "number" &&
    Number.isFinite(pool.gasCostUsd)
  ) {
    return pool.gasCostUsd;
  }
  const raw = (pool && pool.chain) || chainFallback;
  if (raw == null || String(raw).trim() === "") {
    return DEFAULT_GAS_COST_USD;
  }
  const chain = String(raw).toLowerCase();
  return GAS_COST_USD_BY_CHAIN[chain] ?? DEFAULT_GAS_COST_USD;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  if (!items.length) return [];
  const c = Math.max(1, Math.min(concurrency || 4, items.length));
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await mapper(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: c }, () => worker()));
  return out;
}

function buildConfidence(chain, marketDiag, extras = {}) {
  const ch = String(chain).toLowerCase();
  const rpcOk = Boolean(rpcUrlForChain(ch));
  const dex = marketDiag?.dexscreener || {};
  const cg = marketDiag?.coingecko || {};
  const maxAgeSec = parseInt(process.env.QUOTE_MAX_AGE_SEC || "0", 10);
  const qAt = extras.quoteFetchedAt || null;
  let quoteAgeSec = null;
  let quotesStale = false;
  if (qAt && maxAgeSec > 0) {
    const ageMs = Date.now() - new Date(qAt).getTime();
    if (Number.isFinite(ageMs)) {
      quoteAgeSec = Math.max(0, Math.round(ageMs / 1000));
      quotesStale = quoteAgeSec > maxAgeSec;
    }
  }
  return {
    rpcOk,
    rpcLabel: rpcOk ? "RPC OK" : "RPC ausente",
    dexscreenerLastError: dex.lastError || null,
    coingeckoLastError: cg.lastError || null,
    quoteFetchedAt: qAt,
    quoteAgeSec,
    quotesStale,
    quoteMaxAgeSec: maxAgeSec > 0 ? maxAgeSec : null,
    priceSource: extras.priceSource || null,
    scanDurationMs:
      typeof extras.scanDurationMs === "number"
        ? extras.scanDurationMs
        : null
  };
}

function createMarketDiag(marketId) {
  return {
    marketId,
    dexscreener: { requests: 0, errors: 0, lastError: null, cacheHits: 0 },
    coingecko: { errors: 0, lastError: null }
  };
}

function mergeDiagnostics(global, md) {
  if (!md) return;
  global.dexscreener.requests += md.dexscreener.requests || 0;
  global.dexscreener.errors += md.dexscreener.errors || 0;
  global.dexscreener.cacheHits =
    (global.dexscreener.cacheHits || 0) + (md.dexscreener.cacheHits || 0);
  if (md.dexscreener.lastError) {
    global.dexscreener.lastError = md.dexscreener.lastError;
  }
  global.coingecko.errors += md.coingecko.errors || 0;
  if (md.coingecko.lastError) {
    global.coingecko.lastError = md.coingecko.lastError;
  }
  if (!global.byMarket) global.byMarket = [];
  global.byMarket.push({
    marketId: md.marketId,
    dexscreener: { ...md.dexscreener },
    coingecko: { ...md.coingecko }
  });
}

function liquidityImpactUsd(notionalUsd, liquidityUsd) {
  if (
    liquidityUsd == null ||
    liquidityUsd <= 0 ||
    !Number.isFinite(liquidityUsd)
  ) {
    return null;
  }
  const r = notionalUsd / liquidityUsd;
  const frac = Math.min(0.08, r * 0.35);
  return notionalUsd * frac;
}

async function getPrice(pool, marketDiag) {
  const quote = await fetchDexscreenerPairQuote({ axios }, pool, marketDiag);
  const { price, liquidityUsd, quoteFetchedAt, baseToken, quoteToken } = quote;

  const enriched = await enrichPoolRow(
    pool.chain,
    pool,
    DEFAULT_SWAP_FEE_BPS,
    marketDiag
  );

  return {
    dex: pool.name,
    chain: pool.chain.toLowerCase(),
    price,
    feeBps: enriched.feeBps,
    feeSource: enriched.feeSource,
    liquidityUsd,
    gasUsdTx: enriched.gasUsdTx,
    pool,
    quoteFetchedAt,
    baseToken: baseToken || undefined,
    quoteToken: quoteToken || undefined
  };
}

function analyzeMarket(marketLabel, chain, rows) {
  const sorted = [...rows].sort((a, b) => a.price - b.price);
  const buy = sorted[0];
  const sell = sorted[sorted.length - 1];

  const spreadPercent = ((sell.price - buy.price) / buy.price) * 100;
  const grossProfitUsd = NOTIONAL_USD * (sell.price / buy.price - 1);

  let slippageUsd;
  let slippageMode = "bps";
  if (
    useRealChainData() &&
    buy.liquidityUsd != null &&
    sell.liquidityUsd != null
  ) {
    const ib = liquidityImpactUsd(NOTIONAL_USD, buy.liquidityUsd);
    const is = liquidityImpactUsd(NOTIONAL_USD, sell.liquidityUsd);
    if (ib != null && is != null) {
      slippageUsd = ib + is;
      slippageMode = "impact";
    }
  }
  if (slippageMode !== "impact") {
    slippageUsd = (NOTIONAL_USD * SLIPPAGE_BPS) / 10000;
    slippageMode = "bps";
  }

  const gasBuy =
    buy.gasUsdTx != null ? buy.gasUsdTx : gasCostUsdForPool(buy.pool, chain);
  const gasSell =
    sell.gasUsdTx != null ? sell.gasUsdTx : gasCostUsdForPool(sell.pool, chain);
  const gasCostUsd = gasBuy + gasSell;
  const gasSource = buy.gasUsdTx != null ? "rpc" : "table";

  const buyFeeBps = buy.feeBps;
  const sellFeeBps = sell.feeBps;
  const poolFeesUsd = (NOTIONAL_USD * (buyFeeBps + sellFeeBps)) / 10000;
  const netProfitUsd =
    grossProfitUsd - gasCostUsd - slippageUsd - poolFeesUsd;
  const worthwhile = isWorthwhileNet(netProfitUsd);
  const modelWarnings = collectModelStableWarnings(chain, rows);

  return applyWorthwhileGates({
    marketLabel,
    chain,
    buyDex: buy.dex,
    sellDex: sell.dex,
    buyPrice: buy.price,
    sellPrice: sell.price,
    buyFeeBps,
    sellFeeBps,
    buyFeeSource: buy.feeSource,
    sellFeeSource: sell.feeSource,
    spreadPercent,
    grossProfitUsd,
    gasCostUsd,
    gasSource,
    slippageUsd,
    slippageMode,
    poolFeesUsd,
    costsUsd: gasCostUsd + slippageUsd + poolFeesUsd,
    netProfitUsd,
    worthwhile,
    modelWarnings
  });
}

function explainOnchainWorthwhile(a) {
  if (a.jupiterRoundtrip) {
    return [
      `Mercado: ${a.marketLabel}. Round-trip Jupiter (USDC $${NOTIONAL_USD.toFixed(0)} → SOL → USDC): volta ~$${a.stableBackHuman.toFixed(4)} USDC → lucro bruto ~$${a.grossProfitUsd.toFixed(2)}.`,
      `Gas (${a.gasSource}): $${a.gasCostUsd.toFixed(2)}. Slippage modelo: $${a.slippageUsd.toFixed(2)} (${SLIPPAGE_BPS} bps).`,
      "Citação Jupiter v6 (só leitura). Não envia transação."
    ];
  }
  if (a.aggregatorRoundtrip) {
    const p = a.aggregatorProvider || "agregador";
    return [
      `Mercado: ${a.marketLabel}. Round-trip ${p} (${a.collateralSymbol} $${NOTIONAL_USD.toFixed(0)} → base → ${a.collateralSymbol}): volta ~$${a.stableBackHuman.toFixed(4)} → lucro bruto ~$${a.grossProfitUsd.toFixed(2)}.`,
      `Gas (${a.gasSource}): $${a.gasCostUsd.toFixed(2)}. Slippage modelo: $${a.slippageUsd.toFixed(2)} (${SLIPPAGE_BPS} bps). Taxas de pool do modelo (config/RPC fee).`,
      "Quotes 1inch/0x só leitura (sem Quoter on-chain). ENABLE_AGGREGATORS=1 e API keys no servidor."
    ];
  }
  return [
    `Mercado: ${a.marketLabel}. Round-trip on-chain (${a.collateralSymbol} $${NOTIONAL_USD.toFixed(0)} → base → ${a.collateralSymbol}): volta ~$${a.stableBackHuman.toFixed(4)} → lucro bruto ~$${a.grossProfitUsd.toFixed(2)}.`,
    `Gas (${a.gasSource}): $${a.gasCostUsd.toFixed(2)}. Slippage modelo: $${a.slippageUsd.toFixed(2)} (${SLIPPAGE_BPS} bps). Taxas de pool já embutidas nos quotes (não somamos de novo).`,
    "Simulação só leitura (Quoter/pool + estimateGas). Não envia tx; sem MEV."
  ];
}

function explainOnchainNotWorthwhile(a) {
  let lines;
  if (a.jupiterRoundtrip) {
    lines = [
      `Mercado: ${a.marketLabel}. Round-trip Jupiter: volta ~$${a.stableBackHuman.toFixed(4)} USDC (notional $${NOTIONAL_USD.toFixed(0)}) → lucro bruto ~$${a.grossProfitUsd.toFixed(2)}.`,
      `Custos: gas (${a.gasSource}) $${a.gasCostUsd.toFixed(2)} + slippage modelo $${a.slippageUsd.toFixed(2)} → líquido $${a.netProfitUsd.toFixed(2)}.`,
      "ENABLE_JUPITER_SOL=1. Ajuste SLIPPAGE_BPS se necessário."
    ];
  } else if (a.aggregatorRoundtrip) {
    lines = [
      `Mercado: ${a.marketLabel}. Round-trip agregador: volta ~$${a.stableBackHuman.toFixed(4)} ${a.collateralSymbol} → lucro bruto ~$${a.grossProfitUsd.toFixed(2)}.`,
      `Custos: gas (${a.gasSource}) $${a.gasCostUsd.toFixed(2)} + slippage modelo $${a.slippageUsd.toFixed(2)} → líquido $${a.netProfitUsd.toFixed(2)}.`,
      "1inch/0x (só leitura). Polygon com dois USDC não usa este fallback."
    ];
  } else {
    lines = [
      `Mercado: ${a.marketLabel}. Round-trip on-chain: volta ~$${a.stableBackHuman.toFixed(4)} ${a.collateralSymbol} (notional $${NOTIONAL_USD.toFixed(0)}) → lucro bruto ~$${a.grossProfitUsd.toFixed(2)}.`,
      `Custos: gas (${a.gasSource}) $${a.gasCostUsd.toFixed(2)} + slippage modelo $${a.slippageUsd.toFixed(2)} → líquido $${a.netProfitUsd.toFixed(2)}.`,
      "RPC + DISABLE_CURATED_ONCHAIN_QUOTES=0 necessários. Ajuste QUOTE_SIM_FROM se estimateGas falhar."
    ];
  }
  const minN = minNetProfitUsd();
  if (minN > 0 && a.netProfitUsd > 0 && a.netProfitUsd <= minN) {
    lines.push(
      `Lucro líquido ($${a.netProfitUsd.toFixed(2)}) inferior ao mínimo material ($${minN.toFixed(2)} USD). Env MIN_NET_PROFIT_USD=0 remove este filtro.`
    );
  }
  if (a.suppressionReason === "min_spread") {
    lines.push(
      `Spread ${typeof a.spreadPercent === "number" ? a.spreadPercent.toFixed(4) : "—"}% abaixo do mínimo (${minSpreadPercent()}%). MIN_SPREAD_PERCENT=0 desativa.`
    );
  }
  return lines;
}

function explainWorthwhile(a) {
  if (a.onChainRoundtrip) {
    return explainOnchainWorthwhile(a);
  }
  const slipDesc =
    a.slippageMode === "impact"
      ? `impacto (liquidez DexScreener) $${a.slippageUsd.toFixed(2)}`
      : `slippage fixo (${SLIPPAGE_BPS} bps) $${a.slippageUsd.toFixed(2)}`;
  const gasDesc =
    a.gasSource === "rpc" || a.gasSource === "rpc_estimateGas" || a.gasSource === "rpc_swap_limit_x2"
      ? `gas RPC (2 txs) $${a.gasCostUsd.toFixed(2)}`
      : `gas tabela (2 txs) $${a.gasCostUsd.toFixed(2)}`;
  const feeDesc = `taxas de pool (${a.buyFeeBps} bps ${a.buyFeeSource} + ${a.sellFeeBps} bps ${a.sellFeeSource}) $${a.poolFeesUsd.toFixed(2)}`;
  const mw = (a.modelWarnings || []).map((w) => `Aviso (modelo): ${w}`);
  return [
    ...mw,
    `Mercado: ${a.marketLabel}. Lucro líquido: $${a.netProfitUsd.toFixed(2)} (${gasDesc}; ${slipDesc}; ${feeDesc}).`,
    "Preço: DexScreener (snapshot). Gas/fee on-chain só com RPC e USE_REAL_CHAIN_DATA. Impacto por liquidez é aproximação; não inclui MEV nem rota real."
  ];
}

function explainNotWorthwhile(a) {
  if (a.onChainRoundtrip) {
    return explainOnchainNotWorthwhile(a);
  }
  const slipPart =
    a.slippageMode === "impact"
      ? `impacto (liq.) -$${a.slippageUsd.toFixed(2)}`
      : `slippage (${SLIPPAGE_BPS} bps) -$${a.slippageUsd.toFixed(2)}`;
  const minN = minNetProfitUsd();
  let resultadoTxt;
  if (a.netProfitUsd <= 0) {
    resultadoTxt = `Resultado: $${a.netProfitUsd.toFixed(2)} (≤ 0).`;
  } else if (minN > 0 && a.netProfitUsd <= minN) {
    resultadoTxt = `Resultado: $${a.netProfitUsd.toFixed(2)} (positivo mas ≤ mínimo material $${minN.toFixed(2)} USD — MIN_NET_PROFIT_USD).`;
  } else {
    resultadoTxt = `Resultado: $${a.netProfitUsd.toFixed(2)}.`;
  }
  const preamble = [];
  if (a.suppressionReason === "min_spread") {
    preamble.push(
      `Spread ${a.spreadPercent.toFixed(4)}% abaixo do mínimo (${minSpreadPercent()}%). MIN_SPREAD_PERCENT=0 desativa.`
    );
  }
  const lines = [
    ...preamble,
    ...(a.modelWarnings || []).map((w) => `Aviso (modelo): ${w}`),
    `Mercado: ${a.marketLabel}. Spread ~${a.spreadPercent.toFixed(4)}% com notional $${NOTIONAL_USD.toFixed(0)} → lucro bruto ~$${a.grossProfitUsd.toFixed(2)}.`,
    `Custos: gas (${a.gasSource}) -$${a.gasCostUsd.toFixed(2)} + ${slipPart} + pool (${a.buyFeeBps}+${a.sellFeeBps} bps) -$${a.poolFeesUsd.toFixed(2)} = -$${a.costsUsd.toFixed(2)}.`,
    resultadoTxt
  ];
  if (a.grossProfitUsd <= a.costsUsd) {
    lines.push("O lucro bruto não cobre custos estimados.");
  }
  lines.push(
    "RPC por rede + USE_REAL_CHAIN_DATA=1 para gas e fee on-chain; COINGECKO_API_KEY ajuda rate limit. Ajuste SWAP_GAS_LIMIT se necessário."
  );
  return lines;
}

function getTargetChainFromArgv() {
  const arg = process.argv.find((x) => x.startsWith("--chain="));
  if (arg) return arg.slice("--chain=".length).toLowerCase();
  const env = process.env.TARGET_CHAIN;
  return env ? String(env).toLowerCase() : null;
}

function normalizePools(market) {
  const chain = market.chain.toLowerCase();
  return market.pools.map((p) => ({
    name: p.name,
    pair: p.pair,
    chain,
    gasCostUsd: p.gasCostUsd,
    feeBps: p.feeBps
  }));
}

async function getDynamicTemplatesCached() {
  if (DISABLE_DYNAMIC) return [];
  if (!loadSeedByChain()) {
    dynamicTemplatesCache = { ts: 0, list: [] };
    return [];
  }
  const now = Date.now();
  if (
    now - dynamicTemplatesCache.ts < DYNAMIC_CACHE_MS &&
    dynamicTemplatesCache.list.length > 0
  ) {
    return dynamicTemplatesCache.list;
  }
  const list = await buildDynamicMarkets(resilientAxios, {
    maxTotal: MAX_DYNAMIC_MARKETS,
    minLiquidityUsd: dynamicMinLiquidityUsd(NOTIONAL_USD)
  });
  dynamicTemplatesCache = { ts: now, list };
  return list;
}

async function appendMarketScanResult(out, market, diag) {
  if (market.disabled) {
    out.markets.push({
      id: market.id,
      label: market.label,
      chain: market.chain,
      disabled: true,
      setupNote:
        market.setupNote || "Mercado desativado. Preencha pools e defina disabled: false.",
      note: market.note
    });
    return;
  }

  const pools = normalizePools(market);
  if (pools.length < 2) {
    out.markets.push({
      id: market.id,
      label: market.label,
      chain: market.chain,
      error: "São necessários pelo menos 2 pools neste mercado.",
      note: market.note,
      dynamic: market.dynamic
    });
    return;
  }

  const marketDiag = createMarketDiag(market.id);
  try {
    const tableGasLegsUsd = pools.map((p) => gasCostUsdForPool(p));

    const silentSimCodes = new Set(["SKIP", "DISABLE"]);
    let simResult = null;

    if (!market.dynamic && market.chain.toLowerCase() === "solana") {
      if (jupiterEnabled()) {
        const jRes = await tryJupiterSolanaRoundtrip(
          market,
          pools,
          NOTIONAL_USD,
          SLIPPAGE_BPS,
          DEFAULT_SWAP_FEE_BPS,
          (ch, p, fee) => enrichPoolRow(ch, p, fee, marketDiag),
          tableGasLegsUsd
        );
        if (jRes && jRes.ok) {
          const gated = applyWorthwhileGates({ ...jRes.analysis });
          const explanation = gated.worthwhile
            ? explainWorthwhile(gated)
            : explainNotWorthwhile(gated);
          out.markets.push({
            id: market.id,
            label: market.label,
            chain: market.chain,
            note: market.note
              ? `${market.note} · Preços: Jupiter round-trip (REAL).`
              : "Preços: Jupiter round-trip (USDC↔SOL, só leitura).",
            dynamic: market.dynamic,
            prices: jRes.prices,
            confidence: buildConfidence(market.chain, marketDiag, {
              quoteFetchedAt: gated.quoteFetchedAt,
              priceSource: "jupiter"
            }),
            analysis: {
              ...gated,
              explanation
            }
          });
          return;
        }
      }
    } else if (!market.dynamic && market.chain.toLowerCase() !== "solana") {
      simResult = await tryCuratedOnChainRoundtrip(
        market,
        pools,
        NOTIONAL_USD,
        SLIPPAGE_BPS,
        DEFAULT_SWAP_FEE_BPS,
        (ch, p, fee) => enrichPoolRow(ch, p, fee, marketDiag),
        tableGasLegsUsd,
        { marketDiag }
      );
      if (simResult && simResult.ok) {
        const gated = applyWorthwhileGates({ ...simResult.analysis });
        const explanation = gated.worthwhile
          ? explainWorthwhile(gated)
          : explainNotWorthwhile(gated);
        out.markets.push({
          id: market.id,
          label: market.label,
          chain: market.chain,
          note: market.note
            ? `${market.note} · Preços: simulação on-chain (round-trip).`
            : "Preços: simulação on-chain (Quoter/pool + round-trip).",
          dynamic: market.dynamic,
          prices: simResult.prices,
          confidence: buildConfidence(market.chain, marketDiag, {
            quoteFetchedAt: gated.quoteFetchedAt,
            priceSource: "onchain"
          }),
          analysis: {
            ...gated,
            explanation
          }
        });
        return;
      }

      if (
        simResult &&
        !simResult.ok &&
        !silentSimCodes.has(simResult.code) &&
        aggregatorsEnabled()
      ) {
        const agg = await tryAggregatorRoundtrip(
          market,
          pools,
          NOTIONAL_USD,
          SLIPPAGE_BPS,
          DEFAULT_SWAP_FEE_BPS,
          (ch, p, fee) => enrichPoolRow(ch, p, fee, marketDiag),
          tableGasLegsUsd
        );
        if (agg && agg.ok) {
          const gated = applyWorthwhileGates({ ...agg.analysis });
          const explanation = gated.worthwhile
            ? explainWorthwhile(gated)
            : explainNotWorthwhile(gated);
          out.markets.push({
            id: market.id,
            label: market.label,
            chain: market.chain,
            note: market.note
              ? `${market.note} · Fallback 1inch/0x após Quoter falhar.`
              : "Preços: 1inch/0x round-trip (Quoter curado indisponível).",
            dynamic: market.dynamic,
            prices: agg.prices,
            onChainSimFailure: {
              code: simResult.code,
              reason: simResult.reason
            },
            confidence: buildConfidence(market.chain, marketDiag, {
              quoteFetchedAt: gated.quoteFetchedAt,
              priceSource: "aggregator"
            }),
            analysis: {
              ...gated,
              explanation
            }
          });
          return;
        }
      }
    }

    let onChainSimFailure = null;
    if (
      simResult &&
      simResult.ok === false &&
      !silentSimCodes.has(simResult.code)
    ) {
      onChainSimFailure = {
        code: simResult.code,
        reason: simResult.reason
      };
    }

    try {
      const results = await mapWithConcurrency(
        pools,
        DEXSCREENER_CONCURRENCY,
        (p) => getPrice(p, marketDiag)
      );
      const quoteTimes = results
        .map((r) => r.quoteFetchedAt)
        .filter(Boolean);
      const oldestQuote =
        quoteTimes.length > 0 ? quoteTimes.slice().sort()[0] : null;
      const prices = results.map((r) => ({
        dex: r.dex,
        price: r.price,
        feeBps: r.feeBps,
        feeSource: r.feeSource,
        quoteFetchedAt: r.quoteFetchedAt
      }));
      const analysis = analyzeMarket(market.label, market.chain, results);
      const explanation = analysis.worthwhile
        ? explainWorthwhile(analysis)
        : explainNotWorthwhile(analysis);

      const fallbackNote =
        onChainSimFailure != null
          ? "Fallback DexScreener: simulação on-chain falhou (ver aviso no card)."
          : null;
      const composedNote = [market.note, fallbackNote]
        .filter(Boolean)
        .join(" · ");

      out.markets.push({
        id: market.id,
        label: market.label,
        chain: market.chain,
        note: composedNote || undefined,
        dynamic: market.dynamic,
        prices,
        onChainSimFailure,
        confidence: buildConfidence(market.chain, marketDiag, {
          quoteFetchedAt: oldestQuote,
          priceSource: "dexscreener"
        }),
        analysis: {
          ...analysis,
          explanation
        }
      });
    } catch (e) {
      out.markets.push({
        id: market.id,
        label: market.label,
        chain: market.chain,
        error: e.message || String(e),
        note: market.note,
        dynamic: market.dynamic,
        onChainSimFailure,
        confidence: buildConfidence(market.chain, marketDiag, {
          priceSource: "dexscreener"
        })
      });
    }
  } finally {
    mergeDiagnostics(diag, marketDiag);
  }
}

/**
 * @param {{ targetChain?: string | null }} [opts]
 */
async function runScan(opts = {}) {
  const targetChain = opts.targetChain ?? null;
  const seedSnapshot = loadSeedByChain();
  const t0 = Date.now();
  const diag = {
    dexscreener: { requests: 0, errors: 0, lastError: null, cacheHits: 0 },
    coingecko: { errors: 0, lastError: null },
    byMarket: []
  };

  const out = {
    updatedAt: new Date().toISOString(),
    params: {
      notionalUsd: NOTIONAL_USD,
      slippageBps: SLIPPAGE_BPS,
      defaultSwapFeeBps: DEFAULT_SWAP_FEE_BPS,
      gasCostUsdByChain: { ...GAS_COST_USD_BY_CHAIN },
      ...getRealDataSummary(),
      minNetProfitUsd: minNetProfitUsd(),
      minSpreadPercent: minSpreadPercent(),
      quoteMaxAgeSec:
        parseInt(process.env.QUOTE_MAX_AGE_SEC || "0", 10) || null,
      dynamicMinLiquidityUsd: dynamicMinLiquidityUsd(NOTIONAL_USD),
      seedTokensFileLoaded: Boolean(seedSnapshot),
      dynamicDisabled: DISABLE_DYNAMIC,
      maxDynamicMarkets: MAX_DYNAMIC_MARKETS
    },
    markets: []
  };

  if (targetChain) {
    const inCurated = CURATED_MARKETS.some(
      (m) => m.chain.toLowerCase() === targetChain
    );
    const inSeeds =
      seedSnapshot && Object.keys(seedSnapshot).includes(targetChain);
    if (!inCurated && !inSeeds) {
      out.error = `Nenhum mercado ou seed para a chain "${targetChain}".`;
      out.params.scanDurationMs = Date.now() - t0;
      out.params.diagnostics = {
        dexscreener: { ...diag.dexscreener },
        coingecko: { ...diag.coingecko },
        byMarket: [...(diag.byMarket || [])]
      };
      out.intents = [];
      return out;
    }
  }

  const active = CURATED_MARKETS.filter((m) => {
    if (m.disabled) return true;
    if (!targetChain) return true;
    return m.chain.toLowerCase() === targetChain;
  });

  scanDiag.attach(diag);
  try {
    for (const market of active) {
      if (market.disabled) {
        if (targetChain && market.chain.toLowerCase() !== targetChain) continue;
        await appendMarketScanResult(out, market, diag);
        continue;
      }
      if (targetChain && market.chain.toLowerCase() !== targetChain) continue;
      await appendMarketScanResult(out, market, diag);
    }

    const usedIds = new Set(out.markets.map((x) => x.id));
    const templates = await getDynamicTemplatesCached();
    const dynList = templates.filter((m) => {
      if (targetChain && m.chain.toLowerCase() !== targetChain) return false;
      if (usedIds.has(m.id)) return false;
      usedIds.add(m.id);
      return true;
    });

    const parallel = parseInt(process.env.SCAN_PARALLEL || "6", 10);
    for (let i = 0; i < dynList.length; i += parallel) {
      const chunk = dynList.slice(i, i + parallel);
      await Promise.all(chunk.map((m) => appendMarketScanResult(out, m, diag)));
    }

    out.params.dynamicTemplates = templates.length;
    out.params.dynamicScanned = out.markets.filter((m) => m.dynamic).length;

    if (targetChain && out.markets.length === 0 && !out.error) {
      out.error = `Nenhum mercado ativo para "${targetChain}".`;
    }
  } finally {
    scanDiag.detach();
  }

  out.params.scanDurationMs = Date.now() - t0;
  out.params.diagnostics = {
    dexscreener: { ...diag.dexscreener },
    coingecko: { ...diag.coingecko },
    byMarket: (diag.byMarket || []).map((x) => ({
      marketId: x.marketId,
      dexscreener: { ...x.dexscreener },
      coingecko: { ...x.coingecko }
    }))
  };

  const dur = out.params.scanDurationMs;
  if (typeof dur === "number") {
    for (const m of out.markets) {
      if (m.confidence) {
        m.confidence.scanDurationMs = dur;
      }
    }
  }

  let historyNoiseMap = new Map();
  if (process.env.ENABLE_SCAN_HISTORY !== "0") {
    try {
      historyNoiseMap = await buildHistoryNoiseMap();
    } catch {
      /* histórico opcional — não falhar o scan */
    }
  }
  for (const m of out.markets) {
    if (!m || !m.id) continue;
    const hints = historyNoiseMap.get(m.id);
    if (hints && hints.length) m.historyHints = hints;
  }

  out.intents = buildIntentsFromScan(out);

  return out;
}

async function mainCli() {
  const targetChain = getTargetChainFromArgv();
  const report = await runScan({ targetChain });

  if (report.error) {
    console.log(report.error);
    return;
  }

  const maxPrint = parseInt(process.env.CLI_MAX_MARKETS || "18", 10);
  let n = 0;

  for (const block of report.markets) {
    if (n >= maxPrint) {
      console.log(
        `\n… mais ${report.markets.length - maxPrint} mercado(s). Abra http://localhost:3000 ou defina CLI_MAX_MARKETS.`
      );
      break;
    }
    n += 1;

    const head = `${block.chain.toUpperCase()} · ${block.label} (${block.id})`;
    console.log(`\n========== ${head} ==========`);
    if (Array.isArray(block.historyHints)) {
      for (const h of block.historyHints) {
        console.log(`\nHistórico: ${h}`);
      }
    }

    if (block.disabled) {
      console.log("\n(desativado)");
      console.log(block.setupNote);
      if (block.note) console.log(block.note);
      continue;
    }

    if (block.error) {
      console.log(block.error);
      if (block.note) console.log(block.note);
      continue;
    }

    console.log("\n=== PREÇOS ===");
    for (const p of block.prices) {
      console.log(`${p.dex}: $${p.price.toFixed(2)}`);
    }
    if (block.note) console.log(`\nNota: ${block.note}`);

    const a = block.analysis;
    console.log("\n=== ARBITRAGEM (aprox.) ===");
    console.log(`Notional: $${NOTIONAL_USD.toFixed(2)}`);
    console.log(`Comprar em: ${a.buyDex}`);
    console.log(`Vender em: ${a.sellDex}`);
    console.log(`Spread bruto: ${a.spreadPercent.toFixed(4)}%`);
    console.log(`Lucro bruto (USD): $${a.grossProfitUsd.toFixed(2)}`);
    console.log(
      `Gas (${a.gasSource}): -$${a.gasCostUsd.toFixed(2)} (compra + venda)`
    );
    const slipLine =
      a.slippageMode === "impact"
        ? `Impacto (liquidez): -$${a.slippageUsd.toFixed(2)}`
        : `Slippage (${SLIPPAGE_BPS} bps): -$${a.slippageUsd.toFixed(2)}`;
    console.log(slipLine);
    console.log(
      `Taxas de pool (${a.buyFeeBps} bps ${a.buyFeeSource} + ${a.sellFeeBps} bps ${a.sellFeeSource}): -$${a.poolFeesUsd.toFixed(2)}`
    );
    console.log(`Lucro líquido (USD): $${a.netProfitUsd.toFixed(2)}`);
    console.log("\n=== DECISÃO ===");
    console.log(a.worthwhile ? "✅ Sobra margem no modelo." : "❌ Não sobra margem no modelo.");
    console.log("\n--- Por quê ---");
    for (const line of a.explanation) console.log(line);
  }

  if (report.params) {
    console.log("\n--- Resumo ---");
    console.log(
      `Mercados no relatório: ${report.markets.length} · seed JSON: ${report.params.seedTokensFileLoaded ? "sim" : "não"} · dinâmicos (modelo): ${report.params.dynamicTemplates || 0}`
    );
    const rd = report.params.useRealChainData ? "ligado" : "desligado";
    console.log(
      `Dados reais (RPC/CoinGecko/fee on-chain): ${rd} · modelo gas: ${report.params.gasModel || "—"}`
    );
  }
}

/** Legado: lista plana dos pools ativos (útil para scripts). */
const pools = CURATED_MARKETS.filter((m) => !m.disabled).flatMap((m) =>
  normalizePools(m).map((p) => ({
    name: `${m.id}:${p.name}`,
    chain: p.chain,
    pair: p.pair,
    gasCostUsd: p.gasCostUsd
  }))
);

module.exports = {
  NOTIONAL_USD,
  SLIPPAGE_BPS,
  CURATED_MARKETS,
  pools,
  loadSeedByChain,
  runScan,
  mainCli,
  analyzeMarket,
  liquidityImpactUsd
};
