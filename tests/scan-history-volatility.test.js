const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

function loadVolFresh() {
  delete require.cache[require.resolve("../lib/scan-history-volatility.js")];
  delete require.cache[require.resolve("../lib/scan-history.js")];
  return require("../lib/scan-history-volatility.js");
}

describe("scan-history-volatility", () => {
  let tmpDir;
  let histFile;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "scan-vol-"));
    histFile = path.join(tmpDir, "scan-history.jsonl");
    process.env.HISTORY_FILE = histFile;
    process.env.HISTORY_VOLATILITY_WINDOW_SCANS = "20";
    process.env.HISTORY_VOLATILITY_MIN_POINTS = "4";
    process.env.HISTORY_VOLATILITY_STDDEV_SPREAD_MIN = "0.05";
    process.env.HISTORY_VOLATILITY_RANGE_SPREAD_MIN = "0.15";
    process.env.HISTORY_VOLATILITY_ONLY_DYNAMIC = "1";
  });

  afterEach(async () => {
    for (const k of [
      "HISTORY_FILE",
      "HISTORY_VOLATILITY_WINDOW_SCANS",
      "HISTORY_VOLATILITY_MIN_POINTS",
      "HISTORY_VOLATILITY_STDDEV_SPREAD_MIN",
      "HISTORY_VOLATILITY_RANGE_SPREAD_MIN",
      "HISTORY_VOLATILITY_ONLY_DYNAMIC"
    ]) {
      delete process.env[k];
    }
    delete require.cache[require.resolve("../lib/scan-history-volatility.js")];
    delete require.cache[require.resolve("../lib/scan-history.js")];
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("buildHistoryVolatilityHintsMap avisa dyn-* com spread oscilante", async () => {
    const line = (spread) =>
      JSON.stringify({
        t: Date.now(),
        markets: [
          {
            id: "dyn-base-abc",
            chain: "base",
            label: "X / Y",
            worthwhile: true,
            onChainRoundtrip: false,
            spreadPercent: spread
          }
        ]
      }) + "\n";

    const raw =
      line(0.1) + line(0.5) + line(0.2) + line(0.9) + line(0.15) + line(0.12);
    await fs.promises.writeFile(histFile, raw, "utf8");

    const { buildHistoryVolatilityHintsMap } = loadVolFresh();
    const map = await buildHistoryVolatilityHintsMap();
    assert.ok(map.has("dyn-base-abc"));
    const h = map.get("dyn-base-abc").join(" ");
    assert.ok(h.includes("Volatilidade"));
  });

  it("sampleStdevPct", () => {
    const { sampleStdevPct } = loadVolFresh();
    assert.ok(sampleStdevPct([1, 2, 3]) > 0);
    assert.equal(sampleStdevPct([5]), 0);
  });
});
