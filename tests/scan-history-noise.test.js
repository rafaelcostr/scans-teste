const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

function loadNoiseFresh() {
  delete require.cache[require.resolve("../lib/scan-history-noise.js")];
  delete require.cache[require.resolve("../lib/scan-history.js")];
  return require("../lib/scan-history-noise.js");
}

describe("scan-history-noise", () => {
  let tmpDir;
  let histFile;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "scan-noise-"));
    histFile = path.join(tmpDir, "scan-history.jsonl");
    process.env.HISTORY_FILE = histFile;
    process.env.HISTORY_NOISE_WINDOW_SCANS = "20";
    process.env.HISTORY_NOISE_MODEL_MIN = "4";
    process.env.HISTORY_NOISE_ONLY_DYNAMIC = "1";
    delete process.env.ENABLE_SCAN_HISTORY;
  });

  afterEach(async () => {
    delete process.env.HISTORY_FILE;
    delete process.env.HISTORY_NOISE_WINDOW_SCANS;
    delete process.env.HISTORY_NOISE_MODEL_MIN;
    delete process.env.HISTORY_NOISE_ONLY_DYNAMIC;
    delete require.cache[require.resolve("../lib/scan-history-noise.js")];
    delete require.cache[require.resolve("../lib/scan-history.js")];
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("buildHistoryNoiseMap avisa dyn-* com muitos worthwhile só modelo", async () => {
    const line = (worthwhile, onChain) =>
      JSON.stringify({
        t: Date.now(),
        updatedAt: new Date().toISOString(),
        markets: [
          {
            id: "dyn-base-deadbeef",
            chain: "base",
            label: "X / Y",
            worthwhile,
            onChainRoundtrip: onChain
          }
        ]
      }) + "\n";

    let raw = "";
    for (let i = 0; i < 5; i++) {
      raw += line(true, false);
    }
    await fs.promises.writeFile(histFile, raw, "utf8");

    const { buildHistoryNoiseMap } = loadNoiseFresh();
    const map = await buildHistoryNoiseMap();
    assert.ok(map.has("dyn-base-deadbeef"));
    assert.ok(map.get("dyn-base-deadbeef")[0].includes("possível ruído"));
  });

  it("ignora ids não dyn- quando ONLY_DYNAMIC=1", async () => {
    let raw = "";
    for (let i = 0; i < 6; i++) {
      raw +=
        JSON.stringify({
          t: Date.now() + i,
          markets: [
            {
              id: "arb-weth-usdc",
              chain: "arbitrum",
              label: "WETH / USDC",
              worthwhile: true,
              onChainRoundtrip: false
            }
          ]
        }) + "\n";
    }

    await fs.promises.writeFile(histFile, raw, "utf8");
    const { buildHistoryNoiseMap } = loadNoiseFresh();
    const map = await buildHistoryNoiseMap();
    assert.equal(map.has("arb-weth-usdc"), false);
  });
});
