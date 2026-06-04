const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: sleep } = require("node:timers/promises");

const modPath = require.resolve("../lib/rpc-circuit-metrics.js");

function load() {
  delete require.cache[modPath];
  return require("../lib/rpc-circuit-metrics.js");
}

describe("rpc-circuit-metrics", () => {
  const saved = {};

  beforeEach(() => {
    for (const k of [
      "RPC_CIRCUIT_BREAKER",
      "RPC_CB_FAILURE_THRESHOLD",
      "RPC_CB_COOLDOWN_MS"
    ]) {
      saved[k] = process.env[k];
    }
    process.env.RPC_CIRCUIT_BREAKER = "1";
    process.env.RPC_CB_FAILURE_THRESHOLD = "2";
    process.env.RPC_CB_COOLDOWN_MS = "25";
    load().resetRpcCircuitMetricsForTests();
  });

  afterEach(() => {
    load().resetRpcCircuitMetricsForTests();
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    delete require.cache[modPath];
  });

  it("após N falhas assertCircuitClosed lança RPC_CIRCUIT_OPEN", () => {
    const { onRpcFailure, assertCircuitClosed } = load();
    onRpcFailure("base", 0, new Error("a"));
    onRpcFailure("base", 0, new Error("b"));
    assert.throws(
      () => assertCircuitClosed("base", 0),
      (e) => e.code === "RPC_CIRCUIT_OPEN"
    );
  });

  it("cooldown expira e assertCircuitClosed deixa passar", async () => {
    const { onRpcFailure, assertCircuitClosed } = load();
    onRpcFailure("base", 0, new Error("a"));
    onRpcFailure("base", 0, new Error("b"));
    assert.throws(() => assertCircuitClosed("base", 0));
    await sleep(120);
    assert.doesNotThrow(() => assertCircuitClosed("base", 0));
  });

  it("onRpcSuccess fecha circuito e incrementa callsOk", () => {
    const { onRpcFailure, onRpcSuccess, assertCircuitClosed, buildRpcHealthSummary } =
      load();
    onRpcFailure("polygon", 1, new Error("a"));
    onRpcFailure("polygon", 1, new Error("b"));
    assert.throws(() => assertCircuitClosed("polygon", 1));
    onRpcSuccess("polygon", 1, 12);
    assert.doesNotThrow(() => assertCircuitClosed("polygon", 1));
    const h = buildRpcHealthSummary(["polygon"]);
    assert.equal(h.polygon.callsOk, 1);
    assert.equal(h.polygon.callsErr, 2);
    assert.equal(h.polygon.meanLatencyOkMs, 12);
  });

  it("RPC_CIRCUIT_BREAKER=0 não abre circuito mas regista erros", () => {
    process.env.RPC_CIRCUIT_BREAKER = "0";
    const { onRpcFailure, assertCircuitClosed, buildRpcHealthSummary } = load();
    onRpcFailure("arbitrum", 0, new Error("x"));
    onRpcFailure("arbitrum", 0, new Error("y"));
    onRpcFailure("arbitrum", 0, new Error("z"));
    assert.doesNotThrow(() => assertCircuitClosed("arbitrum", 0));
    const h = buildRpcHealthSummary(["arbitrum"]);
    assert.equal(h.arbitrum.callsErr, 3);
    assert.equal(h.arbitrum.endpointsCircuitOpen, 0);
    assert.equal(h.arbitrum.circuitBreaker, false);
  });
});
