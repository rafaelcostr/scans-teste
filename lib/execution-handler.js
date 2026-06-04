/**
 * Valida um intent contra o último scan em cache e executa só **dry-run**
 * (não assina nem envia transação — preparação para um executor real).
 */

const { applyIntentEnvFilters } = require("./scan-intents");
const { evaluateRiskPolicy } = require("./risk-policy");

/**
 * @param {object} intent
 * @param {object | null} scan — getLastScan()
 * @returns {{ ok: boolean, reason?: string, market?: object }}
 */
function validateIntentAgainstScan(intent, scan) {
  if (!intent || typeof intent !== "object") {
    return { ok: false, reason: "intent_invalid" };
  }
  if (!scan || !Array.isArray(scan.markets)) {
    return { ok: false, reason: "no_scan_cache" };
  }

  const filtered = applyIntentEnvFilters([intent]);
  if (filtered.length === 0) {
    return { ok: false, reason: "intent_filtered_by_env" };
  }

  const market = scan.markets.find((m) => m && m.id === intent.marketId);
  if (!market || market.disabled || market.error || !market.analysis) {
    return { ok: false, reason: "market_missing_or_error" };
  }
  if (!market.analysis.worthwhile) {
    return { ok: false, reason: "market_no_longer_worthwhile" };
  }

  const modeOk =
    intent.mode === "onchain"
      ? Boolean(market.analysis.onChainRoundtrip)
      : !market.analysis.onChainRoundtrip;
  if (!modeOk) {
    return { ok: false, reason: "mode_mismatch_vs_scan" };
  }

  if (
    intent.scanUpdatedAt &&
    scan.updatedAt &&
    String(scan.updatedAt) !== String(intent.scanUpdatedAt)
  ) {
    return { ok: false, reason: "scan_stale_updatedAt" };
  }

  const dProfit = Math.abs(
    (intent.netProfitUsd ?? 0) - (market.analysis.netProfitUsd ?? 0)
  );
  const drift = Math.max(
    0.001,
    parseFloat(process.env.EXECUTOR_MAX_PROFIT_DRIFT_USD || "0.08") || 0.08
  );
  if (dProfit > drift) {
    return { ok: false, reason: "netProfitUsd_drift_vs_scan" };
  }

  const risk = evaluateRiskPolicy(intent, market);
  if (!risk.ok) {
    return { ok: false, reason: risk.reason };
  }

  return { ok: true, market };
}

/**
 * Processa um job (dry-run): valida e devolve plano textual para um executor externo.
 * @param {{ intent: object }} job
 * @param {object | null} scan
 */
function dryRunJob(job, scan) {
  const intent = job?.intent;
  const v = validateIntentAgainstScan(intent, scan);
  if (!v.ok) {
    return {
      dryRun: true,
      passed: false,
      reason: v.reason,
      hint:
        "Corra GET /api/scan para refrescar cache. Simulação completa sem saldo: npm run executor:simulate -- --from-server"
    };
  }
  return {
    dryRun: true,
    passed: true,
    plan: {
      action: "external_swap_route_required",
      chain: intent.chain,
      marketId: intent.marketId,
      label: intent.label,
      mode: intent.mode,
      buyDex: intent.buyDex,
      sellDex: intent.sellDex,
      notionalUsd: intent.notionalUsd,
      slippageBps: intent.slippageBps,
      netProfitUsd: intent.netProfitUsd,
      note:
        "Este servidor não envia transações. Use RPC + router/aggregator na vossa stack com calldata gerado a partir dos pools do scan completo (GET /api/scan/export?useLast=1).",
      executorHints: {
        revalidateAgainstScan: true,
        riskPolicyChecked: true,
        manageNonceAndGasOffChain: true,
        respectSlippageBpsFromIntent: intent.slippageBps,
        killSwitchEnv: "EXECUTOR_KILL_SWITCH",
        intentsEndpoint: "/api/intents",
        scanExportHint: "GET /api/scan/export?format=json&useLast=1"
      }
    }
  };
}

module.exports = { validateIntentAgainstScan, dryRunJob };
