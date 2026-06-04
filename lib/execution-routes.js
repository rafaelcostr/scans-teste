/**
 * Rotas HTTP /api/executor/* — fila + tick em dry-run.
 * Regista em server.js com mountExecutorRoutes(app, { getLastScan }).
 */

const {
  enqueueIntents,
  getQueueState,
  listJobs,
  peekNextPending,
  clearCompletedOlderThan
} = require("./execution-queue");
const { dryRunJob } = require("./execution-handler");
const { requireExecutorAuth } = require("./execution-auth");
const { buildIntentsFromScan } = require("./scan-intents");
const {
  runPaperSimulation,
  formatPaperSimReport
} = require("./executor-paper-sim");
const {
  appendPaperTrade,
  getPaperReport,
  readPaperTrades
} = require("./paper-trade-log");

/**
 * @param {import('express').Express} app
 * @param {{ getLastScan: () => object | null }} deps
 */
function mountExecutorRoutes(app, deps) {
  const { getLastScan } = deps;

  app.post("/api/executor/enqueue", requireExecutorAuth, (req, res) => {
    try {
      const scan = getLastScan();
      if (!scan) {
        res.status(409).json({
          error: "Sem scan em cache. Corra GET /api/scan antes de enfileirar."
        });
        return;
      }
      let intents = Array.isArray(req.body?.intents) ? req.body.intents : null;
      if (!intents || intents.length === 0) {
        intents = scan.intents || [];
      }
      const r = enqueueIntents(intents);
      res.json({
        ok: true,
        ...r,
        scanUpdatedAt: scan.updatedAt
      });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  app.post("/api/executor/tick", requireExecutorAuth, (req, res) => {
    try {
      const job = peekNextPending();
      if (!job) {
        res.json({ ok: true, message: "queue_empty", queue: getQueueState() });
        return;
      }
      job.status = "processing";
      try {
        const scan = getLastScan();
        const result = dryRunJob(job, scan);
        if (result.passed === false) {
          job.status = "failed";
          job.error = result.reason || "dry_run_failed";
          job.result = result;
        } else {
          job.status = "completed";
          job.result = result;
        }
        appendPaperTrade(job, job.result, scan).catch(() => {});
      } catch (e) {
        job.status = "failed";
        job.error = e.message || String(e);
        job.result = {
          dryRun: true,
          passed: false,
          reason: "tick_exception"
        };
        appendPaperTrade(job, job.result, getLastScan()).catch(() => {});
      }
      clearCompletedOlderThan(process.env.EXECUTOR_QUEUE_RETAIN || "200");
      res.json({
        ok: true,
        jobId: job.id,
        status: job.status,
        result: job.result,
        queue: getQueueState()
      });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  app.get("/api/executor/queue", requireExecutorAuth, (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "50"), 10) || 50;
      res.json({
        queue: getQueueState(),
        jobs: listJobs({ limit })
      });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  app.get("/api/paper/report", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "100"), 10) || 100;
      const report = await getPaperReport({ limit });
      res.json(report);
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  app.get("/api/paper/trades", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "200"), 10) || 200;
      const trades = await readPaperTrades({ limit });
      res.json({ trades, updatedAt: new Date().toISOString() });
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  /**
   * Simulação didática (sem auth, sem tx): re-sim on-chain se houver RPC.
   * GET /api/executor/paper-sim?marketId=base-weth-usdc&refresh=1
   * GET /api/executor/paper-sim?format=text — relatório legível
   */
  app.get("/api/executor/paper-sim", async (req, res) => {
    try {
      const scan = getLastScan();
      if (!scan) {
        res.status(409).json({
          error: "Sem scan em cache. Abra o painel (GET /api/scan) ou use npm run executor:simulate --chain=base"
        });
        return;
      }
      const intents = buildIntentsFromScan(scan);
      const marketId =
        req.query.marketId && String(req.query.marketId).trim()
          ? String(req.query.marketId).trim()
          : null;
      let intent = marketId
        ? intents.find((i) => i.marketId === marketId)
        : intents.find((i) => i.mode === "onchain") || intents[0];
      if (!intent) {
        res.status(404).json({
          error: marketId
            ? `Nenhum intent para marketId=${marketId}`
            : "Nenhum intent worthwhile no scan",
          availableMarketIds: intents.map((i) => i.marketId)
        });
        return;
      }
      const refresh =
        req.query.refresh !== "0" && req.query.refresh !== "false";
      const report = await runPaperSimulation(scan, intent, {
        refreshOnChain: refresh
      });
      if (req.query.format === "text") {
        res.type("text/plain; charset=utf-8").send(formatPaperSimReport(report));
        return;
      }
      res.json(report);
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });
}

module.exports = { mountExecutorRoutes };
