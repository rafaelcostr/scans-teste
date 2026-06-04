const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  dexscreenerPairUrl,
  fetchDexscreenerPairQuote,
  parseDexscreenerPairPayload
} = require("../lib/sources/dexscreener-client.js");
const fs = require("node:fs");
const path = require("node:path");

describe("dexscreener-client", () => {
  it("dexscreenerPairUrl codifica chain e pair", () => {
    const u = dexscreenerPairUrl("arbitrum", "0xabc");
    assert.ok(u.includes("arbitrum"));
    assert.ok(u.includes("0xabc"));
  });

  it("fetchDexscreenerPairQuote parseia preço e liquidez", async () => {
    const libs = {
      axios: {
        get: async () => ({
          status: 200,
          data: {
            pair: {
              priceUsd: "2500.5",
              liquidity: { usd: 1_000_000 },
              baseToken: {
                address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
                symbol: "WETH"
              },
              quoteToken: {
                address: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
                symbol: "USDC"
              }
            }
          }
        })
      }
    };
    const marketDiag = {
      marketId: "test-m",
      dexscreener: { requests: 0, errors: 0, lastError: null, cacheHits: 0 }
    };
    const q = await fetchDexscreenerPairQuote(
      libs,
      { chain: "arbitrum", pair: "0x1", name: "Test" },
      marketDiag
    );
    assert.equal(q.price, 2500.5);
    assert.equal(q.liquidityUsd, 1_000_000);
    assert.equal(q.baseToken.address.toLowerCase().slice(0, 6), "0x82af");
    assert.equal(q.quoteToken.symbol, "USDC");
    assert.equal(marketDiag.dexscreener.requests, 1);
  });

  it("parseDexscreenerPairPayload lê fixture local (sem rede)", () => {
    const fp = path.join(__dirname, "fixtures", "dexscreener-pair-sample.json");
    const body = JSON.parse(fs.readFileSync(fp, "utf8"));
    const q = parseDexscreenerPairPayload(body, {
      name: "Fixture",
      chain: "polygon",
      pair: "0x1"
    });
    assert.equal(q.price, 1.001);
    assert.equal(q.liquidityUsd, 500000);
    assert.equal(q.quoteToken.symbol, "WETH");
  });
});
