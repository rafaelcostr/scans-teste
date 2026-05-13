const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { scanToCsv, scanToJson } = require("../lib/scan-export.js");

describe("scan-export", () => {
  const baseScan = {
    updatedAt: "2026-05-10T10:00:00.000Z",
    markets: [
      {
        id: "m1",
        chain: "arbitrum",
        label: 'Nome "com", vírgula',
        disabled: false,
        dynamic: false,
        analysis: {
          worthwhile: true,
          netProfitUsd: -0.5,
          spreadPercent: 0.1234,
          buyDex: "orca",
          sellDex: "raydium",
          onChainRoundtrip: true,
          jupiterRoundtrip: false,
          aggregatorRoundtrip: true
        }
      },
      {
        id: "m2",
        chain: "solana",
        label: "S",
        disabled: true,
        setupNote: "off",
        analysis: {}
      }
    ]
  };

  it("scanToCsv inclui cabeçalhos e escapa CSV", () => {
    const csv = scanToCsv(baseScan);
    const lines = csv.trim().split("\n");
    assert.ok(lines[0].startsWith("updatedAt,marketId,chain"));
    assert.equal(lines.length, 3);
    assert.match(lines[1], /arbitrum/);
    assert.match(lines[1], /""com""/);
  });

  it("scanToJson faz round-trip JSON", () => {
    const json = scanToJson(baseScan);
    const back = JSON.parse(json);
    assert.equal(back.markets.length, 2);
    assert.equal(back.markets[0].analysis.netProfitUsd, -0.5);
  });
});
