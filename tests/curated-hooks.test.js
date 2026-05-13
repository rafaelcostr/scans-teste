const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { parseUnits } = require("ethers");
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

describe("tryCuratedOnChainRoundtrip testHooks (sem RPC real)", () => {
  it("QUOTE_STABLE_TO_BASE quando hook simula revert do Quoter", async () => {
    const { tryCuratedOnChainRoundtrip } = loadCuratedFresh();
    const r = await tryCuratedOnChainRoundtrip(
      { label: "WETH / USDC", chain: "arbitrum", dynamic: false },
      arbPools,
      200,
      20,
      30,
      noopEnrich,
      [1, 1],
      {
        getProvider: () => ({}),
        testHooks: {
          skipGasEstimate: true,
          quoteStableToBase: async () => {
            throw new Error("execution reverted: Quoter revert (mock)");
          }
        }
      }
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, "QUOTE_STABLE_TO_BASE");
    assert.match(r.reason, /Quoter revert|execution reverted/i);
  });

  it("QUOTE_BASE_TO_STABLE quando a perna de venda falha (mock)", async () => {
    const { tryCuratedOnChainRoundtrip } = loadCuratedFresh();
    const first = arbPools[0].pair.toLowerCase();
    const r = await tryCuratedOnChainRoundtrip(
      { label: "WETH / USDC", chain: "arbitrum", dynamic: false },
      arbPools,
      200,
      20,
      30,
      noopEnrich,
      [1, 1],
      {
        getProvider: () => ({}),
        testHooks: {
          skipGasEstimate: true,
          quoteStableToBase: async ({ pool }) => {
            if (pool.pair.toLowerCase() === first) {
              return parseUnits("1", 18);
            }
            return parseUnits("0.9", 18);
          },
          quoteBaseToStable: async () => {
            throw new Error("execution reverted: no data (Quoter mock)");
          }
        }
      }
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, "QUOTE_BASE_TO_STABLE");
    assert.match(r.reason, /Quoter mock|execution reverted|no data/i);
  });
});
