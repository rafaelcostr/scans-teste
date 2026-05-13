const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const modPath = require.resolve("../lib/scan-quality.js");

function load() {
  delete require.cache[modPath];
  return require("../lib/scan-quality.js");
}

describe("scan-quality", () => {
  const keys = [
    "MIN_SPREAD_PERCENT",
    "DYNAMIC_MIN_LIQ_USD",
    "DYNAMIC_LIQ_NOTIONAL_MULT"
  ];
  const saved = {};

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    delete require.cache[modPath];
  });

  it("minSpreadPercent default 0", () => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    const { minSpreadPercent } = load();
    assert.equal(minSpreadPercent(), 0);
  });

  it("applyWorthwhileGates suprime worthwhile quando spread < mínimo", () => {
    saved.MIN_SPREAD_PERCENT = process.env.MIN_SPREAD_PERCENT;
    process.env.MIN_SPREAD_PERCENT = "0.5";
    const { applyWorthwhileGates } = load();
    const a = applyWorthwhileGates({
      worthwhile: true,
      spreadPercent: 0.1,
      netProfitUsd: 10
    });
    assert.equal(a.worthwhile, false);
    assert.equal(a.suppressionReason, "min_spread");
  });

  it("dynamicMinLiquidityUsd usa max(base, notional * mult)", () => {
    for (const k of keys) {
      saved[k] = process.env[k];
    }
    delete process.env.MIN_SPREAD_PERCENT;
    process.env.DYNAMIC_MIN_LIQ_USD = "3000";
    process.env.DYNAMIC_LIQ_NOTIONAL_MULT = "2";
    const { dynamicMinLiquidityUsd } = load();
    assert.equal(dynamicMinLiquidityUsd(200), 3000);
    process.env.DYNAMIC_MIN_LIQ_USD = "5000";
    delete require.cache[modPath];
    const mod2 = require("../lib/scan-quality.js");
    assert.equal(mod2.dynamicMinLiquidityUsd(200), 5000);
    delete require.cache[modPath];
    process.env.DYNAMIC_MIN_LIQ_USD = "1000";
    process.env.DYNAMIC_LIQ_NOTIONAL_MULT = "10";
    const mod3 = require("../lib/scan-quality.js");
    assert.equal(mod3.dynamicMinLiquidityUsd(200), 2000);
  });
});
