const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { cgError } = require("../lib/scan-diagnostics.js");

describe("scan-diagnostics cgError com sink por mercado", () => {
  it("incrementa só o sink quando passado", () => {
    const sink = {
      coingecko: { errors: 0, lastError: null }
    };
    cgError("falha de teste", sink);
    assert.equal(sink.coingecko.errors, 1);
    assert.match(sink.coingecko.lastError, /falha de teste/);
  });
});
