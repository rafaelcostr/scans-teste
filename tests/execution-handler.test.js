const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  validateIntentAgainstScan,
  dryRunJob
} = require("../lib/execution-handler.js");

let prevRiskDisabled;

beforeEach(() => {
  prevRiskDisabled = process.env.RISK_POLICY_DISABLED;
  process.env.RISK_POLICY_DISABLED = "1";
});

afterEach(() => {
  if (prevRiskDisabled === undefined) delete process.env.RISK_POLICY_DISABLED;
  else process.env.RISK_POLICY_DISABLED = prevRiskDisabled;
});

function baseScan(overrides = {}) {
  return {
    updatedAt: "2026-01-01T00:00:00.000Z",
    markets: [
      {
        id: "m1",
        chain: "base",
        label: "Pair",
        analysis: {
          worthwhile: true,
          netProfitUsd: 1.5,
          onChainRoundtrip: false
        }
      }
    ],
    ...overrides
  };
}

function baseIntent(overrides = {}) {
  return {
    marketId: "m1",
    chain: "base",
    mode: "model",
    netProfitUsd: 1.5,
    scanUpdatedAt: "2026-01-01T00:00:00.000Z",
    label: "Pair",
    buyDex: "a",
    sellDex: "b",
    notionalUsd: 200,
    slippageBps: 20,
    ...overrides
  };
}

describe("execution-handler validateIntentAgainstScan", () => {
  it("aceita intent alinhado com scan", () => {
    const v = validateIntentAgainstScan(baseIntent(), baseScan());
    assert.equal(v.ok, true);
    assert.equal(v.market.id, "m1");
  });

  it("rejeita sem scan", () => {
    const v = validateIntentAgainstScan(baseIntent(), null);
    assert.equal(v.ok, false);
    assert.equal(v.reason, "no_scan_cache");
  });

  it("rejeita mercado inexistente", () => {
    const v = validateIntentAgainstScan(
      baseIntent({ marketId: "missing" }),
      baseScan()
    );
    assert.equal(v.reason, "market_missing_or_error");
  });

  it("rejeita se não worthwhile", () => {
    const scan = baseScan({
      markets: [
        {
          id: "m1",
          chain: "base",
          label: "P",
          analysis: {
            worthwhile: false,
            netProfitUsd: 1,
            onChainRoundtrip: false
          }
        }
      ]
    });
    const v = validateIntentAgainstScan(baseIntent(), scan);
    assert.equal(v.reason, "market_no_longer_worthwhile");
  });

  it("rejeita mode vs onChainRoundtrip", () => {
    const scan = baseScan({
      markets: [
        {
          id: "m1",
          chain: "base",
          label: "P",
          analysis: {
            worthwhile: true,
            netProfitUsd: 1.5,
            onChainRoundtrip: true
          }
        }
      ]
    });
    const v = validateIntentAgainstScan(baseIntent({ mode: "model" }), scan);
    assert.equal(v.reason, "mode_mismatch_vs_scan");
  });

  it("rejeita scan stale quando updatedAt difere", () => {
    const v = validateIntentAgainstScan(
      baseIntent({ scanUpdatedAt: "2025-12-31T00:00:00.000Z" }),
      baseScan()
    );
    assert.equal(v.reason, "scan_stale_updatedAt");
  });

  it("rejeita drift de lucro acima do limite", () => {
    const v = validateIntentAgainstScan(
      baseIntent({ netProfitUsd: 10 }),
      baseScan()
    );
    assert.equal(v.reason, "netProfitUsd_drift_vs_scan");
  });
});

describe("execution-handler dryRunJob", () => {
  it("dry-run passed inclui plano external_swap_route_required", () => {
    const job = { intent: baseIntent() };
    const out = dryRunJob(job, baseScan());
    assert.equal(out.dryRun, true);
    assert.equal(out.passed, true);
    assert.equal(out.plan.action, "external_swap_route_required");
    assert.equal(out.plan.marketId, "m1");
    assert.ok(out.plan.executorHints);
    assert.equal(out.plan.executorHints.intentsEndpoint, "/api/intents");
  });

  it("dry-run falha com reason da validação", () => {
    const out = dryRunJob({ intent: baseIntent({ marketId: "x" }) }, baseScan());
    assert.equal(out.passed, false);
    assert.equal(out.reason, "market_missing_or_error");
  });
});
