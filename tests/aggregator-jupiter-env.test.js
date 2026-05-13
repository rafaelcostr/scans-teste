const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const aggPath = require.resolve("../lib/aggregator-roundtrip.js");
const jupPath = require.resolve("../lib/jupiter-sol.js");

function reloadAgg() {
  delete require.cache[aggPath];
  return require("../lib/aggregator-roundtrip.js");
}

function reloadJup() {
  delete require.cache[jupPath];
  return require("../lib/jupiter-sol.js");
}

describe("aggregator-roundtrip (env, sem HTTP)", () => {
  const keys = [
    "ENABLE_AGGREGATORS",
    "ONEINCH_API_KEY",
    "ZEROX_API_KEY"
  ];
  const backup = {};

  afterEach(() => {
    for (const k of keys) {
      if (backup[k] === undefined) delete process.env[k];
      else process.env[k] = backup[k];
    }
    delete require.cache[aggPath];
  });

  it("aggregatorsEnabled é false sem flag ou sem chave", () => {
    for (const k of keys) backup[k] = process.env[k];
    delete process.env.ENABLE_AGGREGATORS;
    delete process.env.ONEINCH_API_KEY;
    delete process.env.ZEROX_API_KEY;
    const { aggregatorsEnabled } = reloadAgg();
    assert.equal(aggregatorsEnabled(), false);

    process.env.ENABLE_AGGREGATORS = "1";
    const { aggregatorsEnabled: e2 } = reloadAgg();
    assert.equal(e2(), false);

    process.env.ZEROX_API_KEY = "k";
    const { aggregatorsEnabled: e3 } = reloadAgg();
    assert.equal(e3(), true);
  });

  it("aggregatorsEnabled aceita ENABLE_AGGREGATORS=true", () => {
    for (const k of keys) backup[k] = process.env[k];
    process.env.ENABLE_AGGREGATORS = "true";
    process.env.ONEINCH_API_KEY = "x";
    delete process.env.ZEROX_API_KEY;
    const { aggregatorsEnabled } = reloadAgg();
    assert.equal(aggregatorsEnabled(), true);
  });
});

describe("jupiter-sol (env)", () => {
  const key = "ENABLE_JUPITER_SOL";
  let saved;

  afterEach(() => {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
    delete require.cache[jupPath];
  });

  it("jupiterEnabled só com 1 ou true", () => {
    saved = process.env[key];
    delete process.env[key];
    const { jupiterEnabled: j0 } = reloadJup();
    assert.equal(j0(), false);

    process.env[key] = "0";
    const { jupiterEnabled: j1 } = reloadJup();
    assert.equal(j1(), false);

    process.env[key] = "1";
    const { jupiterEnabled: j2 } = reloadJup();
    assert.equal(j2(), true);

    process.env[key] = "true";
    const { jupiterEnabled: j3 } = reloadJup();
    assert.equal(j3(), true);
  });
});
