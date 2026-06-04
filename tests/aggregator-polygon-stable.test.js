const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const aggPath = require.resolve("../lib/aggregator-roundtrip.js");

function reloadAgg() {
  delete require.cache[aggPath];
  return require("../lib/aggregator-roundtrip.js");
}

describe("aggregator Polygon stable explícito", () => {
  const keys = ["AGGREGATOR_POLYGON_STABLE", "AGGREGATOR_POLYGON_STABLE_DECIMALS"];
  const backup = {};

  afterEach(() => {
    for (const k of keys) {
      if (backup[k] === undefined) delete process.env[k];
      else process.env[k] = backup[k];
    }
    delete require.cache[aggPath];
  });

  it("aggregatorTokensForChain polygon default USDC nativo", () => {
    for (const k of keys) {
      backup[k] = process.env[k];
      delete process.env[k];
    }
    const { aggregatorTokensForChain } = reloadAgg();
    const t = aggregatorTokensForChain("polygon");
    assert.ok(t);
    assert.equal(
      t.stable.toLowerCase(),
      "0x3c499c542cef5e3811e1192ce70d8cc03e5e3342"
    );
    assert.equal(t.stableDecimals, 6);
  });

  it("AGGREGATOR_POLYGON_STABLE aceita override", () => {
    for (const k of keys) backup[k] = process.env[k];
    process.env.AGGREGATOR_POLYGON_STABLE =
      "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
    process.env.AGGREGATOR_POLYGON_STABLE_DECIMALS = "6";
    const { aggregatorTokensForChain } = reloadAgg();
    const t = aggregatorTokensForChain("polygon");
    assert.ok(t);
    assert.equal(
      t.stable.toLowerCase(),
      "0x2791bca1f2de4661ed88a30c99a7a9449aa84174"
    );
  });
});
