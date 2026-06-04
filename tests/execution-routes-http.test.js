const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

const { mountExecutorRoutes } = require("../lib/execution-routes.js");
const {
  resetExecutionQueueForTests,
  getQueueState
} = require("../lib/execution-queue.js");

function mkApp(getLastScan) {
  const app = express();
  app.use(express.json({ limit: "512kb" }));
  mountExecutorRoutes(app, { getLastScan });
  return app;
}

/**
 * @param {import("express").Express} app
 */
function httpJson(app, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const payload =
        body === undefined || body === null
          ? undefined
          : typeof body === "string"
            ? body
            : JSON.stringify(body);
      const reqHeaders = { ...headers };
      if (payload != null) {
        reqHeaders["Content-Type"] = "application/json; charset=utf-8";
        reqHeaders["Content-Length"] = String(Buffer.byteLength(payload, "utf8"));
      }
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method,
          headers: reqHeaders
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => {
            raw += c;
          });
          res.on("end", () => {
            server.close(() => {
              let json = null;
              if (raw) {
                try {
                  json = JSON.parse(raw);
                } catch {
                  json = { _parseError: true, raw };
                }
              }
              resolve({ status: res.statusCode, json, raw });
            });
          });
        }
      );
      req.on("error", (err) => {
        server.close(() => reject(err));
      });
      if (payload != null) req.write(payload, "utf8");
      req.end();
    });
  });
}

function sampleScan() {
  const updatedAt = "2026-01-01T12:00:00.000Z";
  return {
    updatedAt,
    markets: [
      {
        id: "m-http-1",
        chain: "base",
        label: "Test",
        analysis: {
          worthwhile: true,
          netProfitUsd: 2,
          onChainRoundtrip: false
        }
      }
    ],
    intents: [
      {
        marketId: "m-http-1",
        chain: "base",
        mode: "model",
        label: "Test",
        scanUpdatedAt: updatedAt,
        netProfitUsd: 2,
        notionalUsd: 200,
        slippageBps: 20,
        buyDex: "a",
        sellDex: "b"
      }
    ]
  };
}

describe("execution-routes HTTP", () => {
  let prevKey;
  let prevKill;
  let prevRiskDisabled;
  let prevPaperDisabled;

  beforeEach(() => {
    resetExecutionQueueForTests();
    prevKey = process.env.EXECUTOR_API_KEY;
    prevKill = process.env.EXECUTOR_KILL_SWITCH;
    prevRiskDisabled = process.env.RISK_POLICY_DISABLED;
    prevPaperDisabled = process.env.PAPER_LOG_DISABLED;
    delete process.env.EXECUTOR_API_KEY;
    delete process.env.EXECUTOR_KILL_SWITCH;
    process.env.RISK_POLICY_DISABLED = "1";
    process.env.PAPER_LOG_DISABLED = "1";
  });

  afterEach(() => {
    resetExecutionQueueForTests();
    if (prevKey === undefined) delete process.env.EXECUTOR_API_KEY;
    else process.env.EXECUTOR_API_KEY = prevKey;
    if (prevKill === undefined) delete process.env.EXECUTOR_KILL_SWITCH;
    else process.env.EXECUTOR_KILL_SWITCH = prevKill;
    if (prevRiskDisabled === undefined) delete process.env.RISK_POLICY_DISABLED;
    else process.env.RISK_POLICY_DISABLED = prevRiskDisabled;
    if (prevPaperDisabled === undefined) delete process.env.PAPER_LOG_DISABLED;
    else process.env.PAPER_LOG_DISABLED = prevPaperDisabled;
  });

  it("POST /api/executor/enqueue → 503 sem EXECUTOR_API_KEY", async () => {
    const app = mkApp(() => sampleScan());
    const { status, json } = await httpJson(app, "POST", "/api/executor/enqueue", {});
    assert.equal(status, 503);
    assert.match(String(json?.error || ""), /Executor API desligada/i);
  });

  it("POST /api/executor/enqueue → 401 com chave errada", async () => {
    process.env.EXECUTOR_API_KEY = "integration_executor_key_16";
    const app = mkApp(() => sampleScan());
    const { status } = await httpJson(
      app,
      "POST",
      "/api/executor/enqueue",
      {},
      { "X-Executor-Key": "wrong" }
    );
    assert.equal(status, 401);
  });

  it("POST /api/executor/enqueue → 409 sem scan em cache", async () => {
    process.env.EXECUTOR_API_KEY = "integration_executor_key_16";
    const app = mkApp(() => null);
    const { status, json } = await httpJson(
      app,
      "POST",
      "/api/executor/enqueue",
      {},
      { "X-Executor-Key": process.env.EXECUTOR_API_KEY }
    );
    assert.equal(status, 409);
    assert.match(String(json?.error || ""), /cache/i);
  });

  it("POST enqueue + tick com Bearer e dry-run completed", async () => {
    process.env.EXECUTOR_API_KEY = "integration_executor_key_16";
    const scan = sampleScan();
    const app = mkApp(() => scan);

    const enq = await httpJson(
      app,
      "POST",
      "/api/executor/enqueue",
      {},
      { Authorization: `Bearer ${process.env.EXECUTOR_API_KEY}` }
    );
    assert.equal(enq.status, 200);
    assert.equal(enq.json?.ok, true);
    assert.ok((enq.json?.added ?? 0) >= 1);
    assert.equal(getQueueState().pending, 1);

    const tick = await httpJson(
      mkApp(() => scan),
      "POST",
      "/api/executor/tick",
      {},
      { Authorization: `Bearer ${process.env.EXECUTOR_API_KEY}` }
    );
    assert.equal(tick.status, 200);
    assert.equal(tick.json?.status, "completed");
    assert.equal(tick.json?.result?.dryRun, true);
    assert.equal(tick.json?.result?.passed, true);
    assert.equal(tick.json?.result?.plan?.action, "external_swap_route_required");
  });

  it("POST /api/executor/tick → queue_empty quando fila vazia", async () => {
    process.env.EXECUTOR_API_KEY = "integration_executor_key_16";
    const app = mkApp(() => sampleScan());
    const { status, json } = await httpJson(
      app,
      "POST",
      "/api/executor/tick",
      {},
      { "X-Executor-Key": process.env.EXECUTOR_API_KEY }
    );
    assert.equal(status, 200);
    assert.equal(json?.message, "queue_empty");
  });

  it("POST enqueue bloqueado com EXECUTOR_KILL_SWITCH=1", async () => {
    process.env.EXECUTOR_API_KEY = "integration_executor_key_16";
    process.env.EXECUTOR_KILL_SWITCH = "1";
    const app = mkApp(() => sampleScan());
    const { status } = await httpJson(
      app,
      "POST",
      "/api/executor/enqueue",
      {},
      { "X-Executor-Key": process.env.EXECUTOR_API_KEY }
    );
    assert.equal(status, 403);
  });

  it("GET /api/executor/queue lista estado", async () => {
    process.env.EXECUTOR_API_KEY = "integration_executor_key_16";
    const scan = sampleScan();
    const app = mkApp(() => scan);
    await httpJson(
      app,
      "POST",
      "/api/executor/enqueue",
      {},
      { "X-Executor-Key": process.env.EXECUTOR_API_KEY }
    );
    const q = await httpJson(
      mkApp(() => scan),
      "GET",
      "/api/executor/queue",
      null,
      { "X-Executor-Key": process.env.EXECUTOR_API_KEY }
    );
    assert.equal(q.status, 200);
    assert.ok(q.json?.queue);
    assert.ok(Array.isArray(q.json?.jobs));
    assert.equal(q.json.queue.pending, 1);
  });
});
