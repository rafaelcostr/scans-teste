const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  setLastScan,
  getLastScan,
  clearLastScan
} = require("../lib/last-scan-cache.js");

describe("last-scan-cache", () => {
  it("getLastScan é null até setLastScan", () => {
    clearLastScan();
    assert.equal(getLastScan(), null);
  });

  it("setLastScan guarda o objeto; getLastScan devolve a mesma referência", () => {
    clearLastScan();
    const payload = { updatedAt: "x", markets: [] };
    setLastScan(payload);
    assert.strictEqual(getLastScan(), payload);
  });

  it("setLastScan ignora valores inválidos", () => {
    clearLastScan();
    setLastScan(null);
    assert.equal(getLastScan(), null);
    setLastScan("string");
    assert.equal(getLastScan(), null);
  });
});
