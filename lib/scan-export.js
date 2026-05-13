/**
 * Exportação CSV / JSON do resultado de scan.
 */

function csvEscape(val) {
  const s = val == null ? "" : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * @param {object} scan — saída de `runScan()`
 */
function scanToCsv(scan) {
  const headers = [
    "updatedAt",
    "marketId",
    "chain",
    "label",
    "disabled",
    "error",
    "worthwhile",
    "netProfitUsd",
    "spreadPercent",
    "buyDex",
    "sellDex",
    "onChainRoundtrip",
    "jupiterRoundtrip",
    "aggregatorRoundtrip",
    "dynamic"
  ];
  const lines = [headers.join(",")];
  for (const m of scan.markets || []) {
    const a = m.analysis || {};
    const row = [
      scan.updatedAt,
      m.id,
      m.chain,
      m.label,
      m.disabled ? "1" : "",
      m.error || "",
      a.worthwhile != null ? (a.worthwhile ? "1" : "0") : "",
      a.netProfitUsd != null ? String(a.netProfitUsd) : "",
      a.spreadPercent != null ? String(a.spreadPercent) : "",
      a.buyDex || "",
      a.sellDex || "",
      a.onChainRoundtrip ? "1" : "",
      a.jupiterRoundtrip ? "1" : "",
      a.aggregatorRoundtrip ? "1" : "",
      m.dynamic ? "1" : ""
    ].map(csvEscape);
    lines.push(row.join(","));
  }
  return lines.join("\n") + "\n";
}

function scanToJson(scan) {
  return JSON.stringify(scan, null, 2);
}

module.exports = { scanToCsv, scanToJson };
