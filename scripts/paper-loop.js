/**
 * Loop de paper trading:
 *   1) GET /api/scan
 *   2) POST /api/executor/enqueue
 *   3) POST /api/executor/tick ate esvaziar a fila
 *   4) espera PAPER_LOOP_INTERVAL_MS e repete
 *
 * Requer: npm start em outro terminal, EXECUTOR_API_KEY definido.
 */

const axios = require("axios");
const fs = require("fs");
const path = require("path");

function statusFile() {
  return (
    process.env.PAPER_LOOP_STATUS_FILE ||
    path.join(__dirname, "..", "data", "paper-loop-status.json")
  );
}

function writeStatus(status) {
  const file = statusFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(status, null, 2), "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseUrl() {
  return (
    process.env.EXECUTOR_BASE_URL ||
    `http://127.0.0.1:${process.env.PORT || "3000"}`
  ).replace(/\/$/, "");
}

function intervalMs() {
  const n = parseInt(process.env.PAPER_LOOP_INTERVAL_MS || "15000", 10);
  return Math.max(5000, Number.isFinite(n) ? n : 15000);
}

async function http(method, path, body, key) {
  const res = await axios({
    method,
    url: `${baseUrl()}${path}`,
    data: body,
    timeout: 600000,
    headers: key ? { "X-Executor-Key": key } : undefined,
    validateStatus: () => true
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${method.toUpperCase()} ${path} falhou ${res.status}: ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

async function runCycle(key) {
  const cycleStartedAt = new Date().toISOString();
  const scan = await http("get", "/api/scan", null, null);
  const allIntents = Array.isArray(scan.intents) ? scan.intents : [];
  const requireOnchain =
    process.env.RISK_REQUIRE_ONCHAIN === "1" ||
    process.env.RISK_REQUIRE_ONCHAIN === "true";
  const selectedIntents = requireOnchain
    ? allIntents.filter((i) => i && i.mode === "onchain")
    : allIntents;
  const enq = await http(
    "post",
    "/api/executor/enqueue",
    { intents: selectedIntents },
    key
  );
  let ticks = 0;
  let accepted = 0;
  let rejected = 0;

  while (ticks < 500) {
    const tick = await http("post", "/api/executor/tick", {}, key);
    if (tick.message === "queue_empty") break;
    ticks += 1;
    if (tick.result?.passed) accepted += 1;
    else rejected += 1;
  }

  return {
    cycleStartedAt,
    cycleFinishedAt: new Date().toISOString(),
    scanUpdatedAt: scan.updatedAt,
    intents: allIntents.length,
    selectedIntents: selectedIntents.length,
    modelIntentsIgnored: allIntents.length - selectedIntents.length,
    added: enq.added || 0,
    skipped: enq.skipped || 0,
    dropped: enq.dropped || 0,
    ticks,
    accepted,
    rejected
  };
}

async function main() {
  const key = process.env.EXECUTOR_API_KEY && String(process.env.EXECUTOR_API_KEY).trim();
  if (!key) {
    console.error("Defina EXECUTOR_API_KEY no .env/ambiente antes de rodar o loop paper.");
    process.exit(1);
  }
  console.log(`Paper loop ligado em ${baseUrl()} a cada ${intervalMs()} ms.`);
  console.log("Não envia transações. Regista resultados em data/paper-trades.jsonl.");

  while (true) {
    const started = new Date().toISOString();
    try {
      const r = await runCycle(key);
      writeStatus({
        ok: true,
        ...r,
        intervalMs: intervalMs(),
        mode:
          process.env.RISK_REQUIRE_ONCHAIN === "1" ||
          process.env.RISK_REQUIRE_ONCHAIN === "true"
            ? "onchain_only"
            : "model_and_onchain"
      });
      console.log(
        `[${started}] scan=${r.scanUpdatedAt} intents=${r.intents} onchain=${r.selectedIntents} model_ignored=${r.modelIntentsIgnored} enq=${r.added} ticks=${r.ticks} accepted=${r.accepted} rejected=${r.rejected} skipped=${r.skipped} dropped=${r.dropped}`
      );
    } catch (e) {
      writeStatus({
        ok: false,
        cycleFinishedAt: new Date().toISOString(),
        error: e.message || String(e),
        intervalMs: intervalMs()
      });
      console.error(`[${started}] erro: ${e.message || e}`);
    }
    await sleep(intervalMs());
  }
}

main();
