const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { FallbackProvider, JsonRpcProvider } = require("ethers");
const { InstrumentedJsonRpcProvider } = require("../lib/sources/instrumented-json-rpc-provider.js");

const modPath = require.resolve("../lib/sources/rpc-evm.js");

function load() {
  delete require.cache[modPath];
  return require("../lib/sources/rpc-evm.js");
}

describe("rpc-evm fallback URLs", () => {
  const keys = ["RPC_POLYGON", "RPC_URLS_JSON", "RPC_BASE"];
  const saved = {};

  afterEach(() => {
    try {
      require("../lib/rpc-circuit-metrics").resetRpcCircuitMetricsForTests();
    } catch (_) {
      /* ignore */
    }
    try {
      const rpPath = require.resolve("../lib/sources/rpc-evm.js");
      if (require.cache[rpPath]) {
        require.cache[rpPath].exports.clearRpcProviderCacheForTests();
      }
    } catch (_) {
      /* ignore */
    }
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    delete require.cache[modPath];
  });

  it("rpcUrlsForChain parte vírgulas em vários URLs", () => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.RPC_POLYGON =
      "https://polygon.example/a,https://polygon.example/b";
    const { rpcUrlsForChain, getProvider } = load();
    const urls = rpcUrlsForChain("polygon");
    assert.equal(urls.length, 2);
    assert.ok(urls[0].includes("example/a"));
    const p = getProvider("polygon");
    assert.ok(p instanceof FallbackProvider);
  });

  it("RPC_URLS_JSON com array faz merge sem duplicar", () => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.RPC_POLYGON = "https://first.example/rpc";
    process.env.RPC_URLS_JSON = JSON.stringify({
      polygon: ["https://first.example/rpc", "https://second.example/rpc"]
    });
    const { rpcUrlsForChain } = load();
    const urls = rpcUrlsForChain("polygon");
    assert.equal(urls.length, 2);
    assert.equal(urls[0], "https://first.example/rpc");
    assert.equal(urls[1], "https://second.example/rpc");
  });

  it("getProvider com 1 URL usa InstrumentedJsonRpcProvider", () => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.RPC_BASE = "https://base.example/rpc-only";
    const { getProvider } = load();
    const p = getProvider("base");
    assert.ok(p instanceof InstrumentedJsonRpcProvider);
    assert.ok(p instanceof JsonRpcProvider);
  });
});
