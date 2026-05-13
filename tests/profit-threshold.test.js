const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const modPath = require.resolve("../lib/profit-threshold.js");

function load() {
  delete require.cache[modPath];
  return require("../lib/profit-threshold.js");
}

describe("profit-threshold", () => {
  const key = "MIN_NET_PROFIT_USD";
  let saved;

  afterEach(() => {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
    delete require.cache[modPath];
  });

  it("default: lucro tem de ser > 1 USD", () => {
    saved = process.env[key];
    delete process.env[key];
    const { minNetProfitUsd, isWorthwhileNet } = load();
    assert.equal(minNetProfitUsd(), 1);
    assert.equal(isWorthwhileNet(0.11), false);
    assert.equal(isWorthwhileNet(1.01), true);
  });

  it("MIN_NET_PROFIT_USD=0 restaura > 0", () => {
    saved = process.env[key];
    process.env[key] = "0";
    const { minNetProfitUsd, isWorthwhileNet } = load();
    assert.equal(minNetProfitUsd(), 0);
    assert.equal(isWorthwhileNet(0.11), true);
    assert.equal(isWorthwhileNet(-0.01), false);
  });
});
