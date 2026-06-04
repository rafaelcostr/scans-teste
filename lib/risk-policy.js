/**
 * Política de risco para intents do executor.
 *
 * Esta camada ainda não executa trades. Ela define os bloqueios que um
 * executor profissional deve respeitar antes de transformar um intent em ordem.
 */

function boolEnv(name, def = false) {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") return def;
  return v === "1" || String(v).toLowerCase() === "true";
}

function numEnv(name, def) {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function parseChainSet(raw) {
  if (!raw || !String(raw).trim()) return null;
  const set = new Set(
    String(raw)
      .split(/[,;\s]+/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
  );
  return set.size ? set : null;
}

function getRiskPolicyConfig() {
  return {
    enabled: !boolEnv("RISK_POLICY_DISABLED", false),
    requireOnchain: boolEnv("RISK_REQUIRE_ONCHAIN", true),
    allowDynamic: boolEnv("RISK_ALLOW_DYNAMIC", false),
    maxNotionalUsd: numEnv("RISK_MAX_NOTIONAL_USD", 250),
    minNetProfitUsd: numEnv("RISK_MIN_NET_PROFIT_USD", 2),
    minProfitBufferUsd: numEnv("RISK_MIN_PROFIT_BUFFER_USD", 0.25),
    maxSlippageBps: numEnv("RISK_MAX_SLIPPAGE_BPS", 50),
    maxQuoteAgeSec: numEnv("RISK_MAX_QUOTE_AGE_SEC", 20),
    allowedChains: parseChainSet(process.env.RISK_ALLOWED_CHAINS)
  };
}

function secondsSinceIso(iso, nowMs = Date.now()) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (nowMs - t) / 1000);
}

function firstQuoteIso(intent, market) {
  if (intent?.prices && Array.isArray(intent.prices)) {
    const hit = intent.prices.find((p) => p && p.quoteFetchedAt);
    if (hit) return hit.quoteFetchedAt;
  }
  if (market?.analysis?.quoteFetchedAt) return market.analysis.quoteFetchedAt;
  if (market?.prices && Array.isArray(market.prices)) {
    const hit = market.prices.find((p) => p && p.quoteFetchedAt);
    if (hit) return hit.quoteFetchedAt;
  }
  return null;
}

function evaluateRiskPolicy(intent, market, opts = {}) {
  const cfg = opts.config || getRiskPolicyConfig();
  if (!cfg.enabled) {
    return { ok: true, skipped: true, config: cfg };
  }
  if (!intent || !market) {
    return { ok: false, reason: "risk_missing_intent_or_market", config: cfg };
  }

  const chain = String(intent.chain || market.chain || "").toLowerCase();
  if (cfg.allowedChains && !cfg.allowedChains.has(chain)) {
    return { ok: false, reason: "risk_chain_not_allowed", config: cfg };
  }

  const mode = String(intent.mode || "");
  if (cfg.requireOnchain && mode !== "onchain") {
    return { ok: false, reason: "risk_requires_onchain", config: cfg };
  }

  if (!cfg.allowDynamic && (intent.dynamic || market.dynamic)) {
    return { ok: false, reason: "risk_dynamic_market_blocked", config: cfg };
  }

  const notional = Number(intent.notionalUsd);
  if (
    Number.isFinite(cfg.maxNotionalUsd) &&
    cfg.maxNotionalUsd > 0 &&
    Number.isFinite(notional) &&
    notional > cfg.maxNotionalUsd
  ) {
    return { ok: false, reason: "risk_notional_above_limit", config: cfg };
  }

  const net = Number(intent.netProfitUsd);
  const minNet = cfg.minNetProfitUsd + cfg.minProfitBufferUsd;
  if (Number.isFinite(minNet) && Number.isFinite(net) && net < minNet) {
    return { ok: false, reason: "risk_profit_below_buffer", config: cfg };
  }

  const slip = Number(intent.slippageBps);
  if (
    Number.isFinite(cfg.maxSlippageBps) &&
    cfg.maxSlippageBps >= 0 &&
    Number.isFinite(slip) &&
    slip > cfg.maxSlippageBps
  ) {
    return { ok: false, reason: "risk_slippage_above_limit", config: cfg };
  }

  if (Number.isFinite(cfg.maxQuoteAgeSec) && cfg.maxQuoteAgeSec > 0) {
    const age = secondsSinceIso(firstQuoteIso(intent, market), opts.nowMs);
    if (age == null) {
      return { ok: false, reason: "risk_quote_age_unknown", config: cfg };
    }
    if (age > cfg.maxQuoteAgeSec) {
      return { ok: false, reason: "risk_quote_too_old", config: cfg };
    }
  }

  return { ok: true, config: cfg };
}

function getRiskPolicyPublicSummary() {
  const cfg = getRiskPolicyConfig();
  return {
    riskPolicyEnabled: cfg.enabled,
    riskRequireOnchain: cfg.requireOnchain,
    riskAllowDynamic: cfg.allowDynamic,
    riskAllowedChainsActive: Boolean(cfg.allowedChains),
    riskMaxNotionalUsd: cfg.maxNotionalUsd,
    riskMinNetProfitUsd: cfg.minNetProfitUsd,
    riskMinProfitBufferUsd: cfg.minProfitBufferUsd,
    riskMaxSlippageBps: cfg.maxSlippageBps,
    riskMaxQuoteAgeSec: cfg.maxQuoteAgeSec
  };
}

module.exports = {
  getRiskPolicyConfig,
  getRiskPolicyPublicSummary,
  evaluateRiskPolicy,
  secondsSinceIso
};
