const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const modPath = require.resolve("../lib/quote-sim-options.js");

function load() {
  delete require.cache[modPath];
  return require("../lib/quote-sim-options.js");
}

describe("quote-sim-options", () => {
  let saved;

  beforeEach(() => {
    saved = process.env.QUOTE_SIM_BLOCK_TAG;
    delete process.env.QUOTE_SIM_BLOCK_TAG;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.QUOTE_SIM_BLOCK_TAG;
    else process.env.QUOTE_SIM_BLOCK_TAG = saved;
    delete require.cache[modPath];
  });

  it("vazio → sem overrides", () => {
    const { getQuoteSimBlockOverrides } = load();
    assert.deepStrictEqual(getQuoteSimBlockOverrides(), {});
  });

  it("pending → blockTag", () => {
    process.env.QUOTE_SIM_BLOCK_TAG = "pending";
    const { getQuoteSimBlockOverrides } = load();
    assert.deepStrictEqual(getQuoteSimBlockOverrides(), { blockTag: "pending" });
  });

  it("altura decimal", () => {
    process.env.QUOTE_SIM_BLOCK_TAG = "12345";
    const { getQuoteSimBlockOverrides } = load();
    assert.deepStrictEqual(getQuoteSimBlockOverrides(), { blockTag: 12345 });
  });
});
