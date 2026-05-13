/**
 * Heurísticas de “ruído” a partir do histórico JSONL (últimos scans).
 *
 * Env:
 *   HISTORY_NOISE_WINDOW_SCANS — quantas linhas (scans) analisar (default 30)
 *   HISTORY_NOISE_MODEL_MIN — mínimo de vezes worthwhile só modelo para avisar (default 4)
 *   HISTORY_NOISE_ONLY_DYNAMIC — 1 = só mercados dyn-* (default 1)
 */

const { readRecentScanLines } = require("./scan-history");

function truthyDynamicOnly() {
  const e = process.env.HISTORY_NOISE_ONLY_DYNAMIC;
  if (e === "0" || e === "false") return false;
  return true;
}

/**
 * @returns {Promise<Map<string, string[]>>}
 */
async function buildHistoryNoiseMap() {
  const map = new Map();
  const window = Math.min(
    200,
    Math.max(
      5,
      parseInt(process.env.HISTORY_NOISE_WINDOW_SCANS || "30", 10) || 30
    )
  );
  const modelMin = Math.max(
    2,
    parseInt(process.env.HISTORY_NOISE_MODEL_MIN || "4", 10) || 4
  );
  const onlyDyn = truthyDynamicOnly();

  let scans;
  try {
    scans = await readRecentScanLines(window);
  } catch {
    return map;
  }
  if (!Array.isArray(scans) || scans.length === 0) return map;

  /** @type {Map<string, { app: number, wm: number, wo: number }>} */
  const agg = new Map();

  for (const scan of scans) {
    for (const m of scan.markets || []) {
      if (!m || m.disabled || m.error || !m.id) continue;
      if (onlyDyn && !String(m.id).startsWith("dyn-")) continue;
      const id = m.id;
      if (!agg.has(id)) {
        agg.set(id, { app: 0, wm: 0, wo: 0 });
      }
      const s = agg.get(id);
      s.app += 1;
      if (m.worthwhile) {
        if (m.onChainRoundtrip) s.wo += 1;
        else s.wm += 1;
      }
    }
  }

  for (const [id, s] of agg) {
    const hints = [];
    if (s.wm >= modelMin && s.wo === 0) {
      hints.push(
        `Histórico (${scans.length} scans): worthwhile só no modelo DexScreener ${s.wm}× nesta janela; 0× on-chain — possível ruído ou peg, não sinal executável.`
      );
    } else if (s.wm >= modelMin && s.wo > 0 && s.wo < s.wm / 2) {
      hints.push(
        `Histórico: worthwhile no modelo (${s.wm}×) muito mais frequente que on-chain (${s.wo}×) na janela — tratar modelo com desconfiança.`
      );
    }
    if (hints.length) map.set(id, hints);
  }

  return map;
}

module.exports = { buildHistoryNoiseMap };
