const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  dynamicPairPassesQuality,
  passesDexPolicy,
  dynamicPairTokenSymbolsPass
} = require("../lib/dynamic-quality");

const openCfg = {
  minH24VolumeUsd: 0,
  maxVolToLiqRatio: 0,
  minPairAgeMs: 0,
  dexAllowlist: [],
  dexBlocklist: []
};

function pair(over = {}) {
  return {
    dexId: "uniswap",
    liquidity: { usd: 10_000 },
    volume: { h24: 1000 },
    pairCreatedAt: Date.now() - 86400000,
    ...over
  };
}

describe("dynamicPairTokenSymbolsPass", () => {
  afterEach(() => {
    delete process.env.DYNAMIC_SYMBOL_HEURISTICS;
  });

  it("rejeita mesmo símbolo com endereços diferentes (espelho/scam)", () => {
    assert.equal(
      dynamicPairTokenSymbolsPass(
        { symbol: "USDC", address: "0x1111111111111111111111111111111111111111" },
        { symbol: "USDC", address: "0x2222222222222222222222222222222222222222" }
      ),
      false
    );
  });

  it("aceita WETH / USDC legítimo", () => {
    assert.equal(
      dynamicPairTokenSymbolsPass(
        { symbol: "WETH", address: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619" },
        { symbol: "USDC", address: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174" }
      ),
      true
    );
  });

  it("DYNAMIC_SYMBOL_HEURISTICS=0 desliga filtro", () => {
    process.env.DYNAMIC_SYMBOL_HEURISTICS = "0";
    assert.equal(
      dynamicPairTokenSymbolsPass(
        { symbol: "USDC", address: "0x1111111111111111111111111111111111111111" },
        { symbol: "USDC", address: "0x2222222222222222222222222222222222222222" }
      ),
      true
    );
  });
});

describe("dynamic-quality", () => {
  it("rejeita dexId vazio ou unknown", () => {
    assert.equal(dynamicPairPassesQuality(pair({ dexId: "" }), openCfg), false);
    assert.equal(
      dynamicPairPassesQuality(pair({ dexId: "unknown" }), openCfg),
      false
    );
  });

  it("passesDexPolicy respeita allowlist e blocklist", () => {
    assert.equal(
      passesDexPolicy("Uniswap", ["uniswap"], []),
      true
    );
    assert.equal(
      passesDexPolicy("sushiswap", ["uniswap"], []),
      false
    );
    assert.equal(
      passesDexPolicy("uniswap", [], ["uniswap"]),
      false
    );
  });

  it("filtra volume 24h abaixo do mínimo", () => {
    const cfg = { ...openCfg, minH24VolumeUsd: 5000 };
    assert.equal(dynamicPairPassesQuality(pair({ volume: { h24: 100 } }), cfg), false);
    assert.equal(dynamicPairPassesQuality(pair({ volume: { h24: 6000 } }), cfg), true);
  });

  it("filtra razão volume/liquidez alta", () => {
    const cfg = { ...openCfg, maxVolToLiqRatio: 10 };
    assert.equal(
      dynamicPairPassesQuality(
        pair({ liquidity: { usd: 1000 }, volume: { h24: 50000 } }),
        cfg
      ),
      false
    );
    assert.equal(
      dynamicPairPassesQuality(
        pair({ liquidity: { usd: 1000 }, volume: { h24: 5000 } }),
        cfg
      ),
      true
    );
  });

  it("filtra par demasiado novo", () => {
    const cfg = { ...openCfg, minPairAgeMs: 3600000 };
    assert.equal(
      dynamicPairPassesQuality(
        pair({ pairCreatedAt: Date.now() - 60_000 }),
        cfg
      ),
      false
    );
    assert.equal(
      dynamicPairPassesQuality(
        pair({ pairCreatedAt: Date.now() - 7200000 }),
        cfg
      ),
      true
    );
  });
});
