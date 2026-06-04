const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  appendPaperTrade,
  readPaperTrades,
  summarizePaperTrades
} = require("../lib/paper-trade-log.js");

let dir;
let prevFile;
let prevDisabled;

function job(id, netProfitUsd = 3) {
  return {
    id,
    intent: {
      marketId: "base-weth-usdc",
      chain: "base",
      label: "WETH / USDC",
      mode: "onchain",
      notionalUsd: 200,
      slippageBps: 20,
      netProfitUsd,
      scanUpdatedAt: "2026-01-01T00:00:00.000Z"
    }
  };
}

describe("paper-trade-log", () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "paper-trades-"));
    prevFile = process.env.PAPER_TRADES_FILE;
    prevDisabled = process.env.PAPER_LOG_DISABLED;
    process.env.PAPER_TRADES_FILE = path.join(dir, "paper.jsonl");
    delete process.env.PAPER_LOG_DISABLED;
  });

  afterEach(() => {
    if (prevFile === undefined) delete process.env.PAPER_TRADES_FILE;
    else process.env.PAPER_TRADES_FILE = prevFile;
    if (prevDisabled === undefined) delete process.env.PAPER_LOG_DISABLED;
    else process.env.PAPER_LOG_DISABLED = prevDisabled;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("grava aceitos/rejeitados e resume PnL paper", async () => {
    await appendPaperTrade(
      job("j1", 3.5),
      { dryRun: true, passed: true, plan: { netProfitUsd: 3.5 } },
      { updatedAt: "2026-01-01T00:00:00.000Z" }
    );
    await appendPaperTrade(
      job("j2", 1),
      { dryRun: true, passed: false, reason: "risk_profit_below_buffer" },
      { updatedAt: "2026-01-01T00:00:00.000Z" }
    );

    const trades = await readPaperTrades({ limit: 20 });
    assert.equal(trades.length, 2);
    assert.equal(trades[0].decision, "accepted");
    assert.equal(trades[1].decision, "rejected");

    const summary = summarizePaperTrades(trades);
    assert.equal(summary.total, 2);
    assert.equal(summary.accepted, 1);
    assert.equal(summary.rejected, 1);
    assert.equal(summary.totalPaperPnlUsd, 3.5);
    assert.equal(summary.rejectionReasons[0].reason, "risk_profit_below_buffer");
  });
});
