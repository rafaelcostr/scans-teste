const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

function loadHistoryFresh() {
  const p = require.resolve("../lib/scan-history.js");
  delete require.cache[p];
  return require("../lib/scan-history.js");
}

describe("scan-history (ficheiro temporário)", () => {
  let tmpDir;
  let histFile;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "scan-hist-"));
    histFile = path.join(tmpDir, "scan-history.jsonl");
    process.env.HISTORY_FILE = histFile;
    delete process.env.HISTORY_MAX_SCANS;
  });

  afterEach(async () => {
    delete process.env.HISTORY_FILE;
    delete process.env.HISTORY_MAX_SCANS;
    delete require.cache[require.resolve("../lib/scan-history.js")];
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("readHistory devolve [] se o ficheiro não existir", async () => {
    await fs.promises.rm(histFile, { force: true });
    const { readHistory } = loadHistoryFresh();
    const pts = await readHistory({ limit: 10 });
    assert.deepEqual(pts, []);
  });

  it("appendScan + readHistory devolve pontos por mercado", async () => {
    const { appendScan, readHistory } = loadHistoryFresh();
    const scan = {
      updatedAt: "2026-05-01T12:00:00.000Z",
      params: { notionalUsd: 200, scanDurationMs: 100 },
      markets: [
        {
          id: "arb-a",
          chain: "arbitrum",
          label: "Pool A",
          analysis: {
            worthwhile: true,
            netProfitUsd: 1.25,
            spreadPercent: 0.5,
            onChainRoundtrip: true,
            jupiterRoundtrip: false,
            aggregatorRoundtrip: false,
            buyDex: "d1",
            sellDex: "d2"
          }
        }
      ]
    };
    await appendScan(scan);
    const all = await readHistory({ limit: 50 });
    assert.equal(all.length, 1);
    assert.equal(all[0].marketId, "arb-a");
    assert.equal(all[0].netProfitUsd, 1.25);
    assert.equal(all[0].worthwhile, true);

    const filtered = await readHistory({ marketId: "arb-a", limit: 50 });
    assert.equal(filtered.length, 1);

    const miss = await readHistory({ marketId: "other", limit: 50 });
    assert.equal(miss.length, 0);
  });

  it("readRecentScanLines devolve as últimas N linhas parseadas", async () => {
    const { appendScan, readRecentScanLines } = loadHistoryFresh();
    for (let i = 0; i < 5; i++) {
      await appendScan({
        updatedAt: `2026-05-03T10:00:0${i}.000Z`,
        params: {},
        markets: [
          {
            id: `m-${i}`,
            chain: "base",
            label: "L",
            analysis: {
              worthwhile: false,
              netProfitUsd: 0,
              spreadPercent: 0,
              onChainRoundtrip: false,
              buyDex: "a",
              sellDex: "b"
            }
          }
        ]
      });
    }
    const recent = await readRecentScanLines(3);
    assert.equal(recent.length, 3);
    assert.match(recent[0].markets[0].id, /m-2/);
    assert.match(recent[2].markets[0].id, /m-4/);
  });

  it("pruneHistory mantém só as últimas N linhas (HISTORY_MAX_SCANS)", async () => {
    process.env.HISTORY_MAX_SCANS = "4";
    const { appendScan, readHistory } = loadHistoryFresh();
    for (let i = 0; i < 7; i++) {
      await appendScan({
        updatedAt: `2026-05-02T12:00:0${i}.000Z`,
        params: {},
        markets: [
          {
            id: "m1",
            chain: "base",
            label: "L",
            analysis: {
              worthwhile: false,
              netProfitUsd: i * 0.1,
              spreadPercent: 0,
              onChainRoundtrip: false,
              buyDex: "a",
              sellDex: "b"
            }
          }
        ]
      });
    }
    const raw = await fs.promises.readFile(histFile, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 4);
    const parsed = lines.map((l) => JSON.parse(l));
    assert.match(parsed[0].updatedAt, /2026-05-02T12:00:03/);
    assert.match(parsed[3].updatedAt, /2026-05-02T12:00:06/);

    const pts = await readHistory({ marketId: "m1", limit: 50 });
    assert.equal(pts.length, 4);
  });
});
