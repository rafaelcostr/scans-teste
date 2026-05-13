const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { FallbackProvider } = require("ethers");

const modPath = require.resolve("../lib/sources/rpc-evm.js");

function load() {
  delete require.cache[modPath];
  return require("../lib/sources/rpc-evm.js");
}

describe("rpc-evm fallback URLs", () => {
  const keys = ["RPC_POLYGON", "RPC_URLS_JSON"];
  const saved = {};

  afterEach(() => {
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
});
