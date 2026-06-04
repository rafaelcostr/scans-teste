/**
 * Simulação didática de execução (“paper”) — valida o intent, re-corre quotes on-chain
 * ou agregador quando possível, e explica o que uma tx real tentaria fazer.
 *
 * Não usa chave privada nem envia transações.
 */

const { CURATED_MARKETS, NOTIONAL_USD, SLIPPAGE_BPS } = require("../scanner");
const { validateIntentAgainstScan } = require("./execution-handler");
const { tryCuratedOnChainRoundtrip } = require("./curated-onchain-sim");
const {
  tryAggregatorRoundtrip,
  aggregatorsEnabled
} = require("./aggregator-roundtrip");
const {
  tryJupiterSolanaRoundtrip,
  jupiterEnabled
} = require("./jupiter-sol");
const { enrichPoolRow, rpcUrlForChain } = require("./chain-metrics");
const { applyWorthwhileGates } = require("./scan-quality");

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
const DEFAULT_SWAP_FEE_BPS = parseInt(
  process.env.DEFAULT_SWAP_FEE_BPS || "30",
  10
);

function gasCostUsdForPool(pool) {
  if (typeof pool.gasCostUsd === "number" && Number.isFinite(pool.gasCostUsd)) {
    return pool.gasCostUsd;
  }
  const chain = String(pool.chain || "").toLowerCase();
  return GAS_COST_USD_BY_CHAIN[chain] ?? DEFAULT_GAS_COST_USD;
}

function normalizePools(market) {
  const chain = market.chain.toLowerCase();
  return (market.pools || []).map((p) => ({
    name: p.name,
    pair: p.pair,
    chain,
    gasCostUsd: p.gasCostUsd,
    feeBps: p.feeBps
  }));
}

/**
 * @param {object} scan
 * @param {object} intent
 */
function resolveMarketTemplate(scan, intent) {
  const id = intent.marketId;
  const curated = CURATED_MARKETS.find((m) => m.id === id);
  if (curated) {
    return { ok: true, market: curated, source: "curated_catalog" };
  }

  const snap = (scan.markets || []).find((m) => m && m.id === id);
  if (!snap) {
    return { ok: false, reason: "market_not_in_scan" };
  }

  const pools = [];
  const seen = new Set();
  for (const row of snap.prices || []) {
    const pair = row.pool?.pair;
    if (!pair) continue;
    const key = String(pair).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    pools.push({
      name: row.dex || row.pool?.name || "pool",
      pair,
      feeBps: row.feeBps,
      gasCostUsd: row.pool?.gasCostUsd,
      chain: snap.chain
    });
  }

  if (pools.length >= 2) {
    return {
      ok: true,
      market: {
        id: snap.id,
        label: snap.label,
        chain: snap.chain,
        dynamic: Boolean(snap.dynamic),
        pools
      },
      source: "scan_snapshot_pools"
    };
  }

  return {
    ok: false,
    reason: snap.dynamic ? "dynamic_no_pool_addresses" : "not_in_curated_catalog",
    hint:
      "Use um mercado curado (ex. base-weth-usdc) ou garanta que o scan guardou pool.pair nas prices."
  };
}

/**
 * @param {object} scan
 * @param {object} intent
 * @param {{ refreshOnChain?: boolean }} [opts]
 */
async function runPaperSimulation(scan, intent, opts = {}) {
  const refresh = opts.refreshOnChain !== false;
  const out = {
    paperSim: true,
    txWouldBeSent: false,
    intent: {
      marketId: intent.marketId,
      chain: intent.chain,
      label: intent.label,
      mode: intent.mode,
      notionalUsd: intent.notionalUsd,
      netProfitUsdFromScan: intent.netProfitUsd
    },
    validation: null,
    marketSource: null,
    rpcConfigured: false,
    paths: [],
    recommendation: null,
    onChainRefresh: null,
    scanSnapshot: null
  };

  const v = validateIntentAgainstScan(intent, scan);
  out.validation = v;
  if (!v.ok) {
    out.recommendation =
      "Intent não passa validação face ao scan em cache. Corra um scan novo antes de simular execução.";
    return out;
  }

  const chain = String(intent.chain || "").toLowerCase();
  out.rpcConfigured = Boolean(rpcUrlForChain(chain));

  const snap = v.market;
  out.scanSnapshot = {
    worthwhile: Boolean(snap.analysis?.worthwhile),
    netProfitUsd: snap.analysis?.netProfitUsd,
    spreadPercent: snap.analysis?.spreadPercent,
    onChainRoundtrip: Boolean(snap.analysis?.onChainRoundtrip),
    aggregatorRoundtrip: Boolean(snap.analysis?.aggregatorRoundtrip),
    jupiterRoundtrip: Boolean(snap.analysis?.jupiterRoundtrip),
    gasSource: snap.analysis?.gasSource,
    scanUpdatedAt: scan.updatedAt
  };

  if (!refresh) {
    out.paths.push({
      step: "scan_snapshot_only",
      ok: true,
      note: "Modo só leitura: números copiados do último scan (sem re-simular on-chain)."
    });
    out.recommendation =
      "Para re-simular quotes on-chain sem enviar tx, use refreshOnChain: true (precisa RPC na rede).";
    return out;
  }

  const resolved = resolveMarketTemplate(scan, intent);
  if (!resolved.ok) {
    out.paths.push({
      step: "resolve_market",
      ok: false,
      reason: resolved.reason,
      hint: resolved.hint
    });
    out.recommendation = resolved.hint || "Não foi possível montar pools para re-simulação.";
    return out;
  }

  out.marketSource = resolved.source;
  const market = resolved.market;
  const pools = normalizePools(market);
  const notional = intent.notionalUsd ?? NOTIONAL_USD;
  const slip = intent.slippageBps ?? SLIPPAGE_BPS;
  const tableGasLegsUsd = pools.map((p) => gasCostUsdForPool(p));
  const marketDiag = { marketId: market.id, dexscreener: {}, coingecko: {} };

  if (chain === "solana") {
    if (!jupiterEnabled()) {
      out.paths.push({
        step: "jupiter",
        ok: false,
        reason: "ENABLE_JUPITER_SOL desligado"
      });
    } else {
      const jRes = await tryJupiterSolanaRoundtrip(
        market,
        pools,
        notional,
        slip,
        DEFAULT_SWAP_FEE_BPS,
        (ch, p, fee) => enrichPoolRow(ch, p, fee, marketDiag),
        tableGasLegsUsd
      );
      out.paths.push({
        step: "jupiter_roundtrip",
        ok: Boolean(jRes?.ok),
        code: jRes?.code,
        reason: jRes?.reason,
        analysis: jRes?.ok ? applyWorthwhileGates({ ...jRes.analysis }) : null
      });
      if (jRes?.ok) {
        out.onChainRefresh = jRes.analysis;
        out.recommendation = paperSimRecommendation(jRes.analysis, "jupiter");
      }
    }
    return out;
  }

  if (!out.rpcConfigured) {
    out.paths.push({
      step: "rpc",
      ok: false,
      reason: "NO_RPC",
      hint: `Defina RPC_${chain.toUpperCase()} no .env (Alchemy/Infura grátis). Não precisa de saldo na MetaMask para simular.`
    });
    out.recommendation =
      "Sem RPC só podes confiar nos números do scan em cache. Com RPC grátis, a simulação on-chain (eth_call) funciona sem ETH na carteira.";
    return out;
  }

  if (market.dynamic) {
    out.paths.push({
      step: "dynamic_market",
      ok: false,
      note:
        "Mercado dinâmico: simulação on-chain curada pode falhar (pool não está no POOL_ENGINE). Preferir mercados curados para aprender execução."
    });
  }

  const simResult = await tryCuratedOnChainRoundtrip(
    market,
    pools,
    notional,
    slip,
    DEFAULT_SWAP_FEE_BPS,
    (ch, p, fee) => enrichPoolRow(ch, p, fee, marketDiag),
    tableGasLegsUsd,
    { marketDiag }
  );

  out.paths.push({
    step: "curated_onchain_roundtrip",
    ok: Boolean(simResult?.ok),
    code: simResult?.code,
    reason: simResult?.reason
  });

  if (simResult?.ok) {
    const gated = applyWorthwhileGates({ ...simResult.analysis });
    out.onChainRefresh = gated;
    out.recommendation = paperSimRecommendation(gated, "onchain");
    return out;
  }

  if (aggregatorsEnabled() && !market.dynamic) {
    const agg = await tryAggregatorRoundtrip(
      market,
      pools,
      notional,
      slip,
      DEFAULT_SWAP_FEE_BPS,
      (ch, p, fee) => enrichPoolRow(ch, p, fee, marketDiag),
      tableGasLegsUsd
    );
    out.paths.push({
      step: "aggregator_roundtrip",
      ok: Boolean(agg?.ok),
      code: agg?.code,
      reason: agg?.reason
    });
    if (agg?.ok) {
      const gated = applyWorthwhileGates({ ...agg.analysis });
      out.onChainRefresh = gated;
      out.recommendation = paperSimRecommendation(
        gated,
        agg.analysis?.aggregatorProvider || "aggregator"
      );
      return out;
    }
  } else if (!aggregatorsEnabled()) {
    out.paths.push({
      step: "aggregator_roundtrip",
      ok: false,
      skipped: true,
      reason: "ENABLE_AGGREGATORS ou chaves 1inch/0x não configuradas"
    });
  }

  out.recommendation =
    simResult?.reason ||
    "Re-simulação on-chain falhou. No painel, verifique o código (NO_RPC, UNKNOWN_POOL, etc.).";
  return out;
}

function paperSimRecommendation(analysis, sourceLabel) {
  if (!analysis) return null;
  const lines = [];
  lines.push(
    `Fonte da re-simulação: ${sourceLabel}. Lucro líquido estimado agora: ${analysis.netProfitUsd?.toFixed?.(4) ?? analysis.netProfitUsd} USD.`
  );
  lines.push(
    `Spread ${analysis.spreadPercent?.toFixed?.(4) ?? "?"} % · gas ${analysis.gasCostUsd?.toFixed?.(4) ?? "?"} USD (${analysis.gasSource || "?"}).`
  );
  if (analysis.worthwhile) {
    lines.push(
      "Ainda aparece worthwhile na re-simulação — na vida real ainda perderias para bots mais rápidos e para slippage na tx."
    );
  } else {
    lines.push(
      "Já não seria worthwhile na re-simulação — provavelmente não enviarias tx (ou revert / prejuízo)."
    );
  }
  lines.push(
    "Próximo passo com dinheiro real: wallet de teste, cap baixo (ex. 5 USD), só depois de várias simulações iguais."
  );
  return lines.join(" ");
}

/**
 * Texto legível para terminal (didático).
 * @param {object} report
 */
function formatPaperSimReport(report) {
  const lines = [];
  lines.push("");
  lines.push("=== Simulação de execução (PAPER — nenhuma transação enviada) ===");
  lines.push("");
  lines.push("O que isto faz:");
  lines.push("  · Valida o intent face ao último scan");
  lines.push("  · Opcionalmente re-simula on-chain (eth_call) — precisa RPC, NÃO precisa saldo na MetaMask");
  lines.push("  · Mostra o que um executor real tentaria antes de assinar");
  lines.push("");
  lines.push(`Mercado: ${report.intent?.label} (${report.intent?.marketId}) · ${report.intent?.chain}`);
  lines.push(`Modo intent: ${report.intent?.mode} · Notional ~${report.intent?.notionalUsd} USD`);
  lines.push(`Lucro no scan (intent): ${report.intent?.netProfitUsdFromScan} USD`);
  lines.push(`RPC nesta rede: ${report.rpcConfigured ? "sim" : "não"}`);
  if (report.marketSource) lines.push(`Origem dos pools: ${report.marketSource}`);
  lines.push("");

  if (report.validation?.ok) {
    lines.push("[OK] Validação intent vs scan");
  } else {
    lines.push(`[FALHA] Validação: ${report.validation?.reason}`);
  }

  if (report.scanSnapshot) {
    const s = report.scanSnapshot;
    lines.push("");
    lines.push("Snapshot do scan em cache:");
    lines.push(
      `  worthwhile=${s.worthwhile} · net=${s.netProfitUsd} USD · spread=${s.spreadPercent} % · onChain=${s.onChainRoundtrip}`
    );
    lines.push(`  updatedAt=${s.scanUpdatedAt}`);
  }

  lines.push("");
  lines.push("Passos da simulação:");
  for (const p of report.paths || []) {
    const st = p.ok ? "OK" : p.skipped ? "SKIP" : "FALHA";
    lines.push(`  · [${st}] ${p.step}${p.code ? ` (${p.code})` : ""}`);
    if (p.reason) lines.push(`      ${p.reason}`);
    if (p.hint) lines.push(`      → ${p.hint}`);
    if (p.note) lines.push(`      ${p.note}`);
  }

  if (report.onChainRefresh) {
    const a = report.onChainRefresh;
    lines.push("");
    lines.push("Re-simulação on-chain (agora):");
    lines.push(`  Lucro líquido: ${a.netProfitUsd} USD · worthwhile: ${a.worthwhile}`);
    lines.push(`  Gas: ${a.gasCostUsd} USD (${a.gasSource}) · slippage: ${a.slippageUsd} USD`);
    if (a.stableBackHuman != null) {
      lines.push(`  Stable após round-trip (human): ~${a.stableBackHuman}`);
    }
  }

  lines.push("");
  lines.push("Recomendação:");
  lines.push(`  ${report.recommendation || "(nenhuma)"}`);
  lines.push("");
  lines.push("=== Fim (txWouldBeSent: false) ===");
  lines.push("");
  return lines.join("\n");
}

module.exports = {
  resolveMarketTemplate,
  runPaperSimulation,
  formatPaperSimReport,
  paperSimRecommendation
};
