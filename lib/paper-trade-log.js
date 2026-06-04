const fs = require("fs");
const path = require("path");

function paperTradesFile() {
  return (
    process.env.PAPER_TRADES_FILE ||
    path.join(__dirname, "..", "data", "paper-trades.jsonl")
  );
}

function paperLoopStatusFile() {
  return (
    process.env.PAPER_LOOP_STATUS_FILE ||
    path.join(__dirname, "..", "data", "paper-loop-status.json")
  );
}

function paperLogDisabled() {
  return (
    process.env.PAPER_LOG_DISABLED === "1" ||
    process.env.PAPER_LOG_DISABLED === "true"
  );
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function normalizeTradeEvent(job, result, scan) {
  const intent = job?.intent || {};
  const passed = Boolean(result?.passed);
  const plan = result?.plan || {};
  const expectedNetProfitUsd = Number(
    passed ? plan.netProfitUsd : intent.netProfitUsd
  );
  return {
    id: `paper-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    recordedAt: new Date().toISOString(),
    jobId: job?.id || null,
    decision: passed ? "accepted" : "rejected",
    reason: passed ? null : result?.reason || job?.error || "unknown",
    marketId: intent.marketId || null,
    chain: intent.chain || null,
    label: intent.label || null,
    mode: intent.mode || null,
    dynamic: Boolean(intent.dynamic),
    buyDex: intent.buyDex || null,
    sellDex: intent.sellDex || null,
    notionalUsd: Number.isFinite(Number(intent.notionalUsd))
      ? Number(intent.notionalUsd)
      : null,
    slippageBps: Number.isFinite(Number(intent.slippageBps))
      ? Number(intent.slippageBps)
      : null,
    expectedNetProfitUsd: Number.isFinite(expectedNetProfitUsd)
      ? expectedNetProfitUsd
      : null,
    paperPnlUsd:
      passed && Number.isFinite(expectedNetProfitUsd)
        ? expectedNetProfitUsd
        : 0,
    scanUpdatedAt: intent.scanUpdatedAt || scan?.updatedAt || null,
    result
  };
}

async function appendPaperTrade(job, result, scan) {
  if (paperLogDisabled()) return null;
  const file = paperTradesFile();
  ensureDir(file);
  const event = normalizeTradeEvent(job, result, scan);
  await fs.promises.appendFile(file, JSON.stringify(event) + "\n", "utf8");
  return event;
}

async function readPaperTrades(opts = {}) {
  const file = opts.file || paperTradesFile();
  const limit = Math.min(
    5000,
    Math.max(1, parseInt(String(opts.limit || "500"), 10) || 500)
  );
  if (!fs.existsSync(file)) return [];
  const stat = await fs.promises.stat(file);
  const bytes = Math.min(
    stat.size,
    Math.max(64 * 1024, limit * 4096)
  );
  const fd = await fs.promises.open(file, "r");
  let raw = "";
  try {
    const buf = Buffer.alloc(bytes);
    await fd.read(buf, 0, bytes, stat.size - bytes);
    raw = buf.toString("utf8");
  } finally {
    await fd.close();
  }

  const rows = [];
  const lines = raw.split(/\r?\n/).filter(Boolean);
  for (const line of lines.slice(-limit * 2)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
      if (rows.length > limit) rows.shift();
    } catch {
      /* ignora linha truncada/corrompida */
    }
  }
  return rows;
}

function addCount(map, key) {
  const k = key || "unknown";
  map[k] = (map[k] || 0) + 1;
}

function addPnl(map, key, pnl) {
  const k = key || "unknown";
  if (!map[k]) map[k] = { trades: 0, pnlUsd: 0 };
  map[k].trades += 1;
  map[k].pnlUsd += pnl;
}

function summarizePaperTrades(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const accepted = list.filter((x) => x.decision === "accepted");
  const rejected = list.filter((x) => x.decision === "rejected");
  const startingBalanceUsd = Math.max(
    0,
    Number(process.env.PAPER_START_BALANCE_USD || "200") || 200
  );
  const totalPaperPnlUsd = accepted.reduce(
    (sum, x) => sum + (Number(x.paperPnlUsd) || 0),
    0
  );
  const acceptedNotionalUsd = accepted.reduce(
    (sum, x) => sum + (Number(x.notionalUsd) || 0),
    0
  );
  const byReason = {};
  const byChain = {};
  const byMarket = {};
  for (const x of rejected) addCount(byReason, x.reason);
  for (const x of accepted) {
    const pnl = Number(x.paperPnlUsd) || 0;
    addPnl(byChain, x.chain, pnl);
    addPnl(byMarket, x.marketId, pnl);
  }
  const sortedAccepted = accepted
    .slice()
    .sort((a, b) => (Number(b.paperPnlUsd) || 0) - (Number(a.paperPnlUsd) || 0));

  return {
    updatedAt: new Date().toISOString(),
    file: paperTradesFile(),
    total: list.length,
    accepted: accepted.length,
    rejected: rejected.length,
    acceptanceRate:
      list.length > 0 ? accepted.length / list.length : 0,
    startingBalanceUsd,
    currentBalanceUsd: startingBalanceUsd + totalPaperPnlUsd,
    totalPaperPnlUsd,
    acceptedNotionalUsd,
    averageAcceptedPnlUsd:
      accepted.length > 0 ? totalPaperPnlUsd / accepted.length : 0,
    bestTrade: sortedAccepted[0] || null,
    worstAcceptedTrade: sortedAccepted[sortedAccepted.length - 1] || null,
    rejectionReasons: Object.entries(byReason)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    pnlByChain: Object.entries(byChain)
      .map(([chain, v]) => ({ chain, ...v }))
      .sort((a, b) => b.pnlUsd - a.pnlUsd),
    pnlByMarket: Object.entries(byMarket)
      .map(([marketId, v]) => ({ marketId, ...v }))
      .sort((a, b) => b.pnlUsd - a.pnlUsd)
      .slice(0, 25)
  };
}

async function getPaperReport(opts = {}) {
  const trades = await readPaperTrades(opts);
  let loopStatus = null;
  try {
    const raw = await fs.promises.readFile(paperLoopStatusFile(), "utf8");
    loopStatus = JSON.parse(raw);
  } catch {
    loopStatus = null;
  }
  return {
    summary: summarizePaperTrades(trades),
    loopStatus,
    trades
  };
}

module.exports = {
  paperTradesFile,
  paperLoopStatusFile,
  appendPaperTrade,
  readPaperTrades,
  summarizePaperTrades,
  getPaperReport,
  normalizeTradeEvent
};
