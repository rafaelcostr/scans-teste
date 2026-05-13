const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { collectModelStableWarnings } = require("../lib/stable-model-warnings.js");
const { analyzeMarket } = require("../scanner.js");

const WETH = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const USDC_NAT = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

describe("collectModelStableWarnings", () => {
  it("Polygon: avisa quando compra e venda usam stables diferentes", () => {
    const rows = [
      {
        dex: "UniA",
        price: 1990,
        baseToken: { address: WETH, symbol: "WETH" },
        quoteToken: { address: USDC_E, symbol: "USDC.e" }
      },
      {
        dex: "UniB",
        price: 2000,
        baseToken: { address: WETH, symbol: "WETH" },
        quoteToken: { address: USDC_E, symbol: "USDC.e" }
      },
      {
        dex: "UniC",
        price: 2010,
        baseToken: { address: WETH, symbol: "WETH" },
        quoteToken: { address: USDC_NAT, symbol: "USDC" }
      }
    ];
    const w = collectModelStableWarnings("polygon", rows);
    assert.ok(w.some((x) => x.includes("USDC.e") && x.includes("USDC nativo")));
  });

  it("não avisa em arbitrum (só Polygon)", () => {
    const rows = [
      {
        dex: "A",
        price: 1,
        baseToken: { address: WETH, symbol: "WETH" },
        quoteToken: { address: USDC_E, symbol: "USDC" }
      },
      {
        dex: "B",
        price: 1.01,
        baseToken: { address: WETH, symbol: "WETH" },
        quoteToken: { address: USDC_NAT, symbol: "USDC" }
      }
    ];
    assert.equal(collectModelStableWarnings("arbitrum", rows).length, 0);
  });
});

describe("analyzeMarket + modelWarnings", () => {
  it("inclui modelWarnings na análise (Polygon)", () => {
    const a = analyzeMarket("WETH/USDC", "polygon", [
      {
        dex: "Lo",
        price: 100,
        feeBps: 5,
        feeSource: "default",
        pool: {},
        baseToken: { address: WETH },
        quoteToken: { address: USDC_E }
      },
      {
        dex: "Hi",
        price: 102,
        feeBps: 5,
        feeSource: "default",
        pool: {},
        baseToken: { address: WETH },
        quoteToken: { address: USDC_NAT }
      }
    ]);
    assert.ok(Array.isArray(a.modelWarnings));
    assert.ok(a.modelWarnings.length >= 1);
  });
});
