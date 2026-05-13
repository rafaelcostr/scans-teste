const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const curatedPath = path.join(__dirname, "..", "lib", "curated-onchain-sim.js");
const metricsPath = path.join(__dirname, "..", "lib", "chain-metrics.js");

function clearRpcEnv() {
  for (const k of Object.keys(process.env)) {
    if (k === "RPC_URLS_JSON" || k.startsWith("RPC_")) {
      delete process.env[k];
    }
  }
}

function loadCuratedFresh() {
  delete require.cache[require.resolve(curatedPath)];
  delete require.cache[require.resolve(metricsPath)];
  return require(curatedPath);
}

const arbPools = [
  { name: "Uniswap V3", pair: "0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443", feeBps: 5 },
  { name: "SushiSwap", pair: "0x905dfCD5649217c42684f23958568e533C711Aa3", feeBps: 30 }
];

async function noopEnrich() {
  return { feeBps: 30, feeSource: "default", gasUsdTx: null };
}

afterEach(() => {
  delete process.env.DISABLE_CURATED_ONCHAIN_QUOTES;
  clearRpcEnv();
  delete require.cache[require.resolve(curatedPath)];
  delete require.cache[require.resolve(metricsPath)];
});

describe("tryCuratedOnChainRoundtrip", () => {
  it("DISABLE devolve código DISABLE", async () => {
    process.env.DISABLE_CURATED_ONCHAIN_QUOTES = "1";
    const { tryCuratedOnChainRoundtrip } = loadCuratedFresh();
    const r = await tryCuratedOnChainRoundtrip(
      { label: "WETH / USDC", chain: "arbitrum", dynamic: false },
      arbPools,
      200,
      20,
      30,
      noopEnrich,
      [0.1, 0.1]
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, "DISABLE");
  });

  it("Solana devolve SKIP (sem rede)", async () => {
    const { tryCuratedOnChainRoundtrip } = loadCuratedFresh();
    const r = await tryCuratedOnChainRoundtrip(
      { label: "SOL / USDC", chain: "solana", dynamic: false },
      [
        { name: "a", pair: "So11111111111111111111111111111111111111112", feeBps: 30 },
        { name: "b", pair: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", feeBps: 30 }
      ],
      200,
      20,
      30,
      noopEnrich,
      [1, 1]
    );
    assert.equal(r.code, "SKIP");
  });

  it("sem RPC devolve NO_RPC (sem chamadas à rede no teste)", async () => {
    clearRpcEnv();
    process.env.USE_REAL_CHAIN_DATA = "0";
    const { tryCuratedOnChainRoundtrip } = loadCuratedFresh();
    const r = await tryCuratedOnChainRoundtrip(
      { label: "WETH / USDC", chain: "arbitrum", dynamic: false },
      arbPools,
      200,
      20,
      30,
      noopEnrich,
      [0.1, 0.1]
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, "NO_RPC");
  });

  it("getProvider injetado prevalece sobre RPC_* (sem rede)", async () => {
    process.env.RPC_ARBITRUM = "https://rpc-should-not-be-used.test.invalid";
    const { tryCuratedOnChainRoundtrip } = loadCuratedFresh();
    const r = await tryCuratedOnChainRoundtrip(
      { label: "WETH / USDC", chain: "arbitrum", dynamic: false },
      arbPools,
      200,
      20,
      30,
      noopEnrich,
      [0.1, 0.1],
      { getProvider: () => null }
    );
    assert.equal(r.code, "NO_RPC");
  });

  it("pool desconhecido devolve UNKNOWN_POOL", async () => {
    clearRpcEnv();
    process.env.RPC_ARBITRUM = "https://invalid.example.invalid";
    const { tryCuratedOnChainRoundtrip } = loadCuratedFresh();
    const badPools = [
      { name: "X", pair: "0x0000000000000000000000000000000000000001", feeBps: 5 },
      arbPools[1]
    ];
    const r = await tryCuratedOnChainRoundtrip(
      { label: "Bad", chain: "arbitrum", dynamic: false },
      badPools,
      200,
      20,
      30,
      noopEnrich,
      [0.1, 0.1]
    );
    assert.equal(r.code, "UNKNOWN_POOL");
  });
});
