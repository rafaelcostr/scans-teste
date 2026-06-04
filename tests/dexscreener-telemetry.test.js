const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  recordDexscreenerPairFetch,
  getDexscreenerTelemetrySummary,
  resetDexscreenerTelemetryForTests
} = require("../lib/dexscreener-telemetry.js");

describe("dexscreener-telemetry", () => {
  beforeEach(() => {
    resetDexscreenerTelemetryForTests();
    delete process.env.DEXSCREENER_TELEMETRY;
  });

  it("agrega latência por marketId", () => {
    recordDexscreenerPairFetch("m-a", 100, true);
    recordDexscreenerPairFetch("m-a", 200, true);
    const s = getDexscreenerTelemetrySummary({ limit: 10 });
    assert.equal(s.totalPairFetchesOk, 2);
    assert.equal(s.slowestMarkets[0].marketId, "m-a");
    assert.equal(s.slowestMarkets[0].avgMs, 150);
  });
});
