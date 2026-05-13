/**
 * Histórico de scans em JSONL (uma linha JSON por scan).
 * Env: HISTORY_MAX_SCANS (default 200), HISTORY_FILE (opcional caminho absoluto)
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_MAX = parseInt(process.env.HISTORY_MAX_SCANS || "200", 10);

function historyFilePath() {
  if (process.env.HISTORY_FILE && String(process.env.HISTORY_FILE).trim()) {
    return path.resolve(process.env.HISTORY_FILE);
  }
  return path.join(__dirname, "..", "data", "scan-history.jsonl");
}

function slimMarket(m) {
  if (!m || typeof m !== "object") return null;
  if (m.disabled) {
    return {
      id: m.id,
      chain: m.chain,
      label: m.label,
      disabled: true,
      ...(m.dynamic ? { dynamic: true } : {})
    };
  }
  if (m.error) {
    return {
      id: m.id,
      chain: m.chain,
      label: m.label,
      error: m.error,
      ...(m.dynamic ? { dynamic: true } : {})
    };
  }
  const a = m.analysis || {};
  return {
    id: m.id,
    chain: m.chain,
    label: m.label,
    ...(m.dynamic ? { dynamic: true } : {}),
    worthwhile: Boolean(a.worthwhile),
    netProfitUsd:
      typeof a.netProfitUsd === "number" && Number.isFinite(a.netProfitUsd)
        ? a.netProfitUsd
        : null,
    spreadPercent:
      typeof a.spreadPercent === "number" && Number.isFinite(a.spreadPercent)
        ? a.spreadPercent
        : null,
    onChainRoundtrip: Boolean(a.onChainRoundtrip),
    jupiterRoundtrip: Boolean(a.jupiterRoundtrip),
    aggregatorRoundtrip: Boolean(a.aggregatorRoundtrip),
    buyDex: a.buyDex || null,
    sellDex: a.sellDex || null
  };
}

/**
 * @param {object} scan — saída de `runScan()`
 */
async function appendScan(scan) {
  const fp = historyFilePath();
  const line =
    JSON.stringify({
      t: Date.now(),
      updatedAt: scan.updatedAt,
      scanDurationMs: scan.params?.scanDurationMs ?? null,
      notionalUsd: scan.params?.notionalUsd ?? null,
      markets: (scan.markets || []).map(slimMarket).filter(Boolean)
    }) + "\n";
  await fs.promises.mkdir(path.dirname(fp), { recursive: true });
  await fs.promises.appendFile(fp, line, "utf8");
  await pruneHistory(fp, DEFAULT_MAX);
}

async function pruneHistory(fp, maxLines) {
  try {
    const raw = await fs.promises.readFile(fp, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length <= maxLines) return;
    const keep = lines.slice(-maxLines);
    await fs.promises.writeFile(fp, keep.join("\n") + "\n", "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return;
    throw e;
  }
}

/**
 * @param {{ marketId?: string, limit?: number }} opts
 * @returns {Promise<object[]>} pontos ordenados por tempo (crescente)
 */
async function readHistory(opts = {}) {
  const fp = historyFilePath();
  const limit = Math.min(
    500,
    Math.max(1, parseInt(String(opts.limit || "120"), 10) || 120)
  );
  const marketId = opts.marketId ? String(opts.marketId) : null;
  let raw = "";
  try {
    raw = await fs.promises.readFile(fp, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return [];
    throw e;
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const rows = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  const tail = rows.slice(-limit);
  const points = [];
  for (const row of tail) {
    const ts = row.t || Date.parse(row.updatedAt || "") || 0;
    for (const m of row.markets || []) {
      if (!m || m.disabled || m.error) continue;
      if (marketId && m.id !== marketId) continue;
      points.push({
        t: ts,
        updatedAt: row.updatedAt,
        marketId: m.id,
        chain: m.chain,
        label: m.label,
        netProfitUsd: m.netProfitUsd,
        spreadPercent: m.spreadPercent,
        worthwhile: m.worthwhile
      });
    }
  }
  points.sort((a, b) => a.t - b.t);
  return points;
}

/**
 * Últimas N linhas do JSONL parseadas (cada elemento = um scan gravado).
 * @param {number} maxScans
 * @returns {Promise<object[]>}
 */
async function readRecentScanLines(maxScans) {
  const fp = historyFilePath();
  const max = Math.min(
    500,
    Math.max(1, parseInt(String(maxScans ?? "30"), 10) || 30)
  );
  let raw = "";
  try {
    raw = await fs.promises.readFile(fp, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return [];
    throw e;
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const tail = lines.slice(-max);
  const out = [];
  for (const line of tail) {
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  return out;
}

module.exports = {
  appendScan,
  readHistory,
  historyFilePath,
  readRecentScanLines
};
