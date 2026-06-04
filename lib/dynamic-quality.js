/**
 * Filtros opcionais para mercados dinâmicos (DexScreener + seeds).
 * Env:
 *   DYNAMIC_MIN_H24_VOLUME_USD — volume 24h mínimo (USD) do par; 0 = desligado
 *   DYNAMIC_MAX_VOL_TO_LIQ_RATIO — rejeita vol24h/liquidity acima disto (ex. 80); 0 = desligado
 *   DYNAMIC_MIN_PAIR_AGE_HOURS — idade mínima do par (ms internos); 0 = desligado
 *   DYNAMIC_DEX_ALLOWLIST — dexId permitidos (vírgula); vazio = todos (exceto unknown)
 *   DYNAMIC_DEX_BLOCKLIST — dexId excluídos (vírgula)
 *   DYNAMIC_SYMBOL_HEURISTICS — 0 = desliga rejeição por símbolo espelho/suspeito (default ligado)
 */

function parseCommaList(key) {
  const raw = process.env[key];
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function getDynamicQualityConfig() {
  const minVol = parseFloat(process.env.DYNAMIC_MIN_H24_VOLUME_USD || "0");
  const maxRatio = parseFloat(process.env.DYNAMIC_MAX_VOL_TO_LIQ_RATIO || "0");
  const minAgeH = parseFloat(process.env.DYNAMIC_MIN_PAIR_AGE_HOURS || "0");
  return {
    minH24VolumeUsd:
      Number.isFinite(minVol) && minVol > 0 ? minVol : 0,
    maxVolToLiqRatio:
      Number.isFinite(maxRatio) && maxRatio > 0 ? maxRatio : 0,
    minPairAgeMs:
      Number.isFinite(minAgeH) && minAgeH > 0 ? minAgeH * 3600000 : 0,
    dexAllowlist: parseCommaList("DYNAMIC_DEX_ALLOWLIST"),
    dexBlocklist: parseCommaList("DYNAMIC_DEX_BLOCKLIST")
  };
}

function volumeH24Usd(pair) {
  const v = Number(pair?.volume?.h24);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function passesPairAge(pair, minAgeMs) {
  if (!minAgeMs) return true;
  const created = pair?.pairCreatedAt;
  if (created == null || !Number.isFinite(Number(created))) return true;
  const age = Date.now() - Number(created);
  return age >= minAgeMs;
}

function passesVolumeAndRatio(pair, minVol, maxRatio) {
  const liq = Number(pair?.liquidity?.usd ?? 0);
  const vol = volumeH24Usd(pair);
  if (minVol > 0 && vol < minVol) return false;
  if (maxRatio > 0 && liq > 0) {
    const r = vol / liq;
    if (Number.isFinite(r) && r > maxRatio) return false;
  }
  return true;
}

/**
 * @param {string} dexId
 * @param {string[]} allowlist lower
 * @param {string[]} blocklist lower
 */
function passesDexPolicy(dexId, allowlist, blocklist) {
  const d = String(dexId || "")
    .trim()
    .toLowerCase();
  if (!d || d === "unknown") return false;
  if (blocklist.length && blocklist.includes(d)) return false;
  if (allowlist.length && !allowlist.includes(d)) return false;
  return true;
}

/**
 * Um par DexScreener entra no agrupamento dinâmico?
 * @param {object} pair — elemento de res.data.pairs
 * @param {{ minH24VolumeUsd: number, maxVolToLiqRatio: number, minPairAgeMs: number, dexAllowlist: string[], dexBlocklist: string[] }} cfg
 */
function dynamicPairPassesQuality(pair, cfg) {
  if (!pair || typeof pair !== "object") return false;
  const dexId = pair.dexId;
  if (!passesDexPolicy(dexId, cfg.dexAllowlist, cfg.dexBlocklist)) {
    return false;
  }
  if (!passesVolumeAndRatio(pair, cfg.minH24VolumeUsd, cfg.maxVolToLiqRatio)) {
    return false;
  }
  if (!passesPairAge(pair, cfg.minPairAgeMs)) return false;
  return true;
}

function dynamicPairTokenSymbolsPass(baseToken, quoteToken) {
  if (process.env.DYNAMIC_SYMBOL_HEURISTICS === "0") return true;
  const sb = String(baseToken?.symbol || "").trim();
  const sq = String(quoteToken?.symbol || "").trim();
  const ba = String(baseToken?.address || "").toLowerCase();
  const qa = String(quoteToken?.address || "").toLowerCase();
  if (!sb || !sq) return true;
  if (!/^0x[a-f0-9]{40}$/.test(ba) || !/^0x[a-f0-9]{40}$/.test(qa)) return true;
  if (ba === qa) return false;
  if (sb.toLowerCase() === sq.toLowerCase() && ba !== qa) return false;
  if (sb.length < 2 || sq.length < 2 || sb.length > 24 || sq.length > 24) {
    return false;
  }
  if (/^\d+$/.test(sb) || /^\d+$/.test(sq)) return false;
  return true;
}

module.exports = {
  getDynamicQualityConfig,
  dynamicPairPassesQuality,
  passesDexPolicy,
  volumeH24Usd,
  dynamicPairTokenSymbolsPass
};
