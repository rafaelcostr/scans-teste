const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { computeSignalModelMetrics } = require("../lib/stable-signal-metrics");

const WETH = "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619";
const USDC_E = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";
const USDC_NAT = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";

describe("stable-signal-metrics", () => {
  it("Polygon: mediana WETH por stable e cross basis bps", () => {
    const rows = [
      {
        dex: "U1",
        price: 2000,
        baseToken: { address: WETH },
        quoteToken: { address: USDC_E }
      },
      {
        dex: "U2",
        price: 2010,
        baseToken: { address: WETH },
        quoteToken: { address: USDC_NAT }
      }
    ];
    const m = computeSignalModelMetrics("polygon", rows);
    assert.ok(m.stablePeg);
    assert.ok(m.stablePeg.crossStableBasisBps.length >= 1);
    const x = m.stablePeg.crossStableBasisBps[0];
    assert.ok(x.basisBps > 40 && x.basisBps < 60);
  });

  it("não polygon → stablePeg null", () => {
    const m = computeSignalModelMetrics("arbitrum", []);
    assert.equal(m.stablePeg, null);
  });
});
