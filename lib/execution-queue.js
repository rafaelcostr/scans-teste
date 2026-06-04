/**
 * Fila in-memory de jobs de execução (intents).
 * Idempotência: mesma chave (marketId|chain|mode|scanUpdatedAt) não duplica em pending.
 *
 * Env: EXECUTOR_QUEUE_MAX (default 100)
 */

const MAX_DEFAULT = 100;

function intentDedupeKey(intent) {
  if (!intent || typeof intent !== "object") return "";
  const mid = String(intent.marketId || "");
  const ch = String(intent.chain || "").toLowerCase();
  const mode = String(intent.mode || "");
  const ts = String(intent.scanUpdatedAt || "");
  return `${mid}|${ch}|${mode}|${ts}`;
}

function maxQueueSize() {
  const n = parseInt(process.env.EXECUTOR_QUEUE_MAX || String(MAX_DEFAULT), 10);
  return Math.min(5000, Math.max(1, Number.isFinite(n) ? n : MAX_DEFAULT));
}

/** @type {{ id: string, intent: object, status: string, createdAt: string, error?: string, result?: object }[]} */
const jobs = [];

function jobSnapshot(j) {
  return {
    id: j.id,
    status: j.status,
    createdAt: j.createdAt,
    marketId: j.intent?.marketId,
    chain: j.intent?.chain,
    mode: j.intent?.mode,
    netProfitUsd: j.intent?.netProfitUsd,
    error: j.error || null,
    result: j.result || null
  };
}

function hasPendingDuplicate(key) {
  if (!key) return false;
  return jobs.some(
    (j) =>
      (j.status === "pending" || j.status === "processing") &&
      intentDedupeKey(j.intent) === key
  );
}

/**
 * @param {object[]} intents
 * @returns {{ added: number, skipped: number, dropped: number, ids: string[] }}
 */
function enqueueIntents(intents) {
  const cap = maxQueueSize();
  let added = 0;
  let skipped = 0;
  let dropped = 0;
  const ids = [];
  const list = Array.isArray(intents) ? intents : [];

  for (let i = 0; i < list.length; i++) {
    const intent = list[i];
    if (jobs.length >= cap) {
      dropped = list.length - i;
      break;
    }
    const key = intentDedupeKey(intent);
    if (!key || !intent.marketId) {
      skipped += 1;
      continue;
    }
    if (hasPendingDuplicate(key)) {
      skipped += 1;
      continue;
    }
    const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    jobs.push({
      id,
      intent: { ...intent },
      status: "pending",
      createdAt: new Date().toISOString()
    });
    ids.push(id);
    added += 1;
  }

  return { added, skipped, dropped, ids };
}

function getQueueState() {
  const pending = jobs.filter((j) => j.status === "pending").length;
  const processing = jobs.filter((j) => j.status === "processing").length;
  const completed = jobs.filter((j) => j.status === "completed").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  return {
    total: jobs.length,
    pending,
    processing,
    completed,
    failed,
    max: maxQueueSize()
  };
}

function listJobs(opts = {}) {
  const limit = Math.min(200, Math.max(1, parseInt(String(opts.limit || "50"), 10) || 50));
  return jobs.slice(-limit).map(jobSnapshot);
}

/**
 * @returns {object | null}
 */
function peekNextPending() {
  return jobs.find((j) => j.status === "pending") || null;
}

function clearCompletedOlderThan(maxKeep) {
  const keep = Math.min(5000, Math.max(20, parseInt(String(maxKeep || "200"), 10) || 200));
  const terminal = jobs.filter(
    (j) => j.status === "completed" || j.status === "failed"
  );
  if (terminal.length <= keep) return;
  const toRemove = terminal.slice(0, terminal.length - keep).map((j) => j.id);
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (toRemove.includes(jobs[i].id)) jobs.splice(i, 1);
  }
}

/** Só para testes */
function resetExecutionQueueForTests() {
  jobs.length = 0;
}

module.exports = {
  intentDedupeKey,
  enqueueIntents,
  getQueueState,
  listJobs,
  peekNextPending,
  clearCompletedOlderThan,
  resetExecutionQueueForTests,
  jobSnapshot
};
