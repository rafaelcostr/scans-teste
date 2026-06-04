const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  evaluateRiskPolicy,
  getRiskPolicyPublicSummary,
  secondsSinceIso
} = require("../lib/risk-policy.js");

const RISK_ENV = [
  "RISK_POLICY_DISABLED",
  "RISK_REQUIRE_ONCHAIN",
  "RISK_ALLOW_DYNAMIC",
  "RISK_ALLOWED_CHAINS",
  "RISK_MAX_NOTIONAL_USD",
  "RISK_MIN_NET_PROFIT_USD",
  "RISK_MIN_PROFIT_BUFFER_USD",
  "RISK_MAX_SLIPPAGE_BPS",
  "RISK_MAX_QUOTE_AGE_SEC"
];

let prev = {};

function clearRiskEnv() {
  for (const k of RISK_ENV) delete process.env[k];
}

function intent(overrides = {}) {
  return {
    marketId: "m1",
    chain: "base",
    mode: "onchain",
    dynamic: false,
    notionalUsd: 200,
    slippageBps: 20,
    netProfitUsd: 3,
    prices: [{ dex: "a", quoteFetchedAt: "2026-01-01T00:00:10.000Z" }],
    ...overrides
  };
}

function market(overrides = {}) {
  return {
    id: "m1",
    chain: "base",
    dynamic: false,
    analysis: {
      onChainRoundtrip: true,
      quoteFetchedAt: "2026-01-01T00:00:10.000Z"
    },
    ...overrides
  };
}

describe("risk-policy", () => {
  beforeEach(() => {
    prev = {};
    for (const k of RISK_ENV) prev[k] = process.env[k];
    clearRiskEnv();
  });

  afterEach(() => {
    clearRiskEnv();
    for (const [k, v] of Object.entries(prev)) {
      if (v !== undefined) process.env[k] = v;
    }
  });

  it("aprova intent on-chain recente dentro dos limites default", () => {
    const out = evaluateRiskPolicy(intent(), market(), {
      nowMs: new Date("2026-01-01T00:00:20.000Z").getTime()
    });
    assert.equal(out.ok, true);
  });

  it("bloqueia modo model por default", () => {
    const out = evaluateRiskPolicy(intent({ mode: "model" }), market(), {
      nowMs: new Date("2026-01-01T00:00:20.000Z").getTime()
    });
    assert.equal(out.reason, "risk_requires_onchain");
  });

  it("bloqueia mercado dinamico por default", () => {
    const out = evaluateRiskPolicy(intent({ dynamic: true }), market(), {
      nowMs: new Date("2026-01-01T00:00:20.000Z").getTime()
    });
    assert.equal(out.reason, "risk_dynamic_market_blocked");
  });

  it("bloqueia notional, slippage, lucro e quote velha", () => {
    assert.equal(
      evaluateRiskPolicy(intent({ notionalUsd: 300 }), market(), {
        nowMs: new Date("2026-01-01T00:00:20.000Z").getTime()
      }).reason,
      "risk_notional_above_limit"
    );
    assert.equal(
      evaluateRiskPolicy(intent({ slippageBps: 80 }), market(), {
        nowMs: new Date("2026-01-01T00:00:20.000Z").getTime()
      }).reason,
      "risk_slippage_above_limit"
    );
    assert.equal(
      evaluateRiskPolicy(intent({ netProfitUsd: 2.1 }), market(), {
        nowMs: new Date("2026-01-01T00:00:20.000Z").getTime()
      }).reason,
      "risk_profit_below_buffer"
    );
    assert.equal(
      evaluateRiskPolicy(intent(), market(), {
        nowMs: new Date("2026-01-01T00:01:00.000Z").getTime()
      }).reason,
      "risk_quote_too_old"
    );
  });

  it("respeita allowlist de chains e resumo publico", () => {
    process.env.RISK_ALLOWED_CHAINS = "arbitrum,polygon";
    const out = evaluateRiskPolicy(intent(), market(), {
      nowMs: new Date("2026-01-01T00:00:20.000Z").getTime()
    });
    assert.equal(out.reason, "risk_chain_not_allowed");
    assert.equal(getRiskPolicyPublicSummary().riskAllowedChainsActive, true);
  });

  it("secondsSinceIso devolve null para datas invalidas", () => {
    assert.equal(secondsSinceIso("x"), null);
  });
});
