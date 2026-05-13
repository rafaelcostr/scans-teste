const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const modPath = require.resolve("../lib/scan-intents.js");

function load() {
  delete require.cache[modPath];
  return require("../lib/scan-intents.js");
}

const keys = [
  "INTENTS_ONCHAIN_ONLY",
  "INTENTS_CHAINS",
  "INTENTS_MIN_NET_USD"
];

describe("scan-intents", () => {
  const saved = {};

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    delete require.cache[modPath];
  });

  it("applyIntentEnvFilters: INTENTS_ONCHAIN_ONLY", () => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.INTENTS_ONCHAIN_ONLY = "1";
    const { applyIntentEnvFilters } = load();
    const list = applyIntentEnvFilters([
      { mode: "model", chain: "arbitrum", netProfitUsd: 10 },
      { mode: "onchain", chain: "base", netProfitUsd: 2 }
    ]);
    assert.equal(list.length, 1);
    assert.equal(list[0].chain, "base");
  });

  it("applyIntentEnvFilters: INTENTS_CHAINS", () => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.INTENTS_CHAINS = "arbitrum; polygon";
    const { applyIntentEnvFilters } = load();
    const list = applyIntentEnvFilters([
      { mode: "onchain", chain: "arbitrum", netProfitUsd: 1 },
      { mode: "onchain", chain: "base", netProfitUsd: 1 }
    ]);
    assert.equal(list.length, 1);
    assert.equal(list[0].chain, "arbitrum");
  });

  it("applyIntentEnvFilters: INTENTS_MIN_NET_USD", () => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.INTENTS_MIN_NET_USD = "5";
    const { applyIntentEnvFilters } = load();
    const list = applyIntentEnvFilters([
      { mode: "onchain", chain: "arbitrum", netProfitUsd: 4 },
      { mode: "onchain", chain: "arbitrum", netProfitUsd: 5.01 }
    ]);
    assert.equal(list.length, 1);
    assert.equal(list[0].netProfitUsd, 5.01);
  });
});
