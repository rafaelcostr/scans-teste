const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveMarketTemplate,
  runPaperSimulation,
  formatPaperSimReport
} = require("../lib/executor-paper-sim.js");

function baseScan() {
  return {
    updatedAt: "2026-01-01T12:00:00.000Z",
    markets: [
      {
        id: "base-weth-usdc",
        chain: "base",
        label: "WETH / USDC",
        analysis: {
          worthwhile: true,
          netProfitUsd: 1.2,
          spreadPercent: 0.05,
          onChainRoundtrip: true,
          buyDex: "Aerodrome",
          sellDex: "Uniswap V3"
        },
        prices: []
      }
    ]
  };
}

function baseIntent() {
  return {
    marketId: "base-weth-usdc",
    chain: "base",
    label: "WETH / USDC",
    mode: "onchain",
    notionalUsd: 200,
    slippageBps: 20,
    netProfitUsd: 1.2,
    scanUpdatedAt: "2026-01-01T12:00:00.000Z"
  };
}

describe("executor-paper-sim", () => {
  let prevRiskDisabled;

  beforeEach(() => {
    prevRiskDisabled = process.env.RISK_POLICY_DISABLED;
    process.env.RISK_POLICY_DISABLED = "1";
  });

  afterEach(() => {
    if (prevRiskDisabled === undefined) delete process.env.RISK_POLICY_DISABLED;
    else process.env.RISK_POLICY_DISABLED = prevRiskDisabled;
  });

  it("resolveMarketTemplate encontra mercado curado", () => {
    const r = resolveMarketTemplate(baseScan(), baseIntent());
    assert.equal(r.ok, true);
    assert.equal(r.source, "curated_catalog");
    assert.ok(r.market.pools.length >= 2);
  });

  it("validação falha se scanUpdatedAt diferente", async () => {
    const report = await runPaperSimulation(
      baseScan(),
      { ...baseIntent(), scanUpdatedAt: "old" },
      { refreshOnChain: false }
    );
    assert.equal(report.validation.ok, false);
    assert.equal(report.txWouldBeSent, false);
  });

  it("snapshot-only não chama refresh on-chain", async () => {
    const report = await runPaperSimulation(baseScan(), baseIntent(), {
      refreshOnChain: false
    });
    assert.equal(report.paperSim, true);
    assert.ok(report.paths.some((p) => p.step === "scan_snapshot_only"));
    assert.equal(report.onChainRefresh, null);
  });

  it("formatPaperSimReport inclui cabeçalho paper", () => {
    const txt = formatPaperSimReport({
      intent: { marketId: "x", chain: "base", label: "L", mode: "onchain" },
      validation: { ok: true },
      paths: [],
      txWouldBeSent: false
    });
    assert.ok(txt.includes("PAPER"));
    assert.ok(txt.includes("txWouldBeSent: false"));
  });
});
