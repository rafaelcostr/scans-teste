/**
 * Avisos para o modelo DexScreener quando o “spread” pode misturar stables
 * diferentes (ex.: USDC.e vs USDC nativo em Polygon) ou par stable–stable.
 */

const POLYGON_STABLES = {
  "0x2791bca1f2de4661ed88a30c99a7a9449aa84174": {
    key: "usdc.e",
    label: "USDC.e (PoS)"
  },
  "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": {
    key: "usdc.native",
    label: "USDC nativo"
  },
  "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": {
    key: "usdt",
    label: "USDT"
  },
  "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063": {
    key: "dai",
    label: "DAI"
  }
};

function normAddr(a) {
  if (!a || typeof a !== "string") return null;
  const s = a.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(s) ? s : null;
}

function stableInfoFromTokens(baseToken, quoteToken) {
  const b = normAddr(baseToken?.address);
  const q = normAddr(quoteToken?.address);
  if (!b || !q) return null;
  const bs = POLYGON_STABLES[b];
  const qs = POLYGON_STABLES[q];
  if (bs && qs) {
    return { kind: "stable_stable", a: bs, b: qs };
  }
  if (bs && !qs) {
    return { kind: "one_stable", stable: bs };
  }
  if (!bs && qs) {
    return { kind: "one_stable", stable: qs };
  }
  return null;
}

/**
 * @param {string} chain
 * @param {Array<{ price: number, dex: string, baseToken?: object, quoteToken?: object }>} rows — saída de getPrice (DexScreener)
 * @returns {string[]}
 */
function collectModelStableWarnings(chain, rows) {
  const warns = [];
  const c = String(chain || "").toLowerCase();
  if (c !== "polygon" || !Array.isArray(rows) || rows.length < 2) {
    return warns;
  }

  const seenStableStable = new Set();
  for (const r of rows) {
    const info = stableInfoFromTokens(r.baseToken, r.quoteToken);
    if (info?.kind === "stable_stable") {
      const k = `${info.a.key}|${info.b.key}`;
      if (!seenStableStable.has(k)) {
        seenStableStable.add(k);
        warns.push(
          `Par em ${r.dex} com duas stables (${info.a.label} / ${info.b.label}): o preço em USD do DexScreener pode não ser comparável com pools WETH/stable.`
        );
      }
    }
  }

  const sorted = [...rows].sort((a, b) => a.price - b.price);
  const buy = sorted[0];
  const sell = sorted[sorted.length - 1];
  const buyInfo = stableInfoFromTokens(buy.baseToken, buy.quoteToken);
  const sellInfo = stableInfoFromTokens(sell.baseToken, sell.quoteToken);
  if (buyInfo?.kind === "one_stable" && sellInfo?.kind === "one_stable") {
    if (buyInfo.stable.key !== sellInfo.stable.key) {
      warns.push(
        `Compra (${buy.dex}, ${buyInfo.stable.label}) vs venda (${sell.dex}, ${sellInfo.stable.label}): são contratos de stable diferentes — o spread modelo pode refletir peg/depeg, não arbitragem “limpa” entre DEX no mesmo ativo.`
      );
    } else {
      const rel = Math.abs(sell.price - buy.price) / buy.price;
      if (rel > 0.003) {
        warns.push(
          `Mesmo tipo de stable (${buyInfo.stable.label}) mas preços DexScreener divergem ~${(rel * 100).toFixed(3)}% entre ${buy.dex} e ${sell.dex} — pode ser liquidez/quote stale, não oportunidade real.`
        );
      }
    }
  }

  return [...new Set(warns)];
}

module.exports = { collectModelStableWarnings, stableInfoFromTokens, normAddr };
