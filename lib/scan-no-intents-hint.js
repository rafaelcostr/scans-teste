/**
 * Texto de ajuda quando buildIntentsFromScan devolve lista vazia.
 */

const { minNetProfitUsd } = require("./profit-threshold");

/**
 * @param {object} scan
 * @returns {string}
 */
function formatNoIntentsHint(scan) {
  const lines = [];
  const minN = minNetProfitUsd();
  const markets = (scan.markets || []).filter((m) => m && !m.disabled);

  lines.push("");
  lines.push("=== Porque não há intents neste scan? ===");
  lines.push("");
  lines.push(
    `Intent = mercado "worthwhile" (lucro líquido > ${minN} USD por defeito; env MIN_NET_PROFIT_USD).`
  );
  lines.push("");

  const withAnalysis = markets.filter((m) => m.analysis && !m.error);
  const worthwhile = withAnalysis.filter((m) => m.analysis.worthwhile);
  const positiveNotWorth = withAnalysis.filter(
    (m) =>
      !m.analysis.worthwhile &&
      typeof m.analysis.netProfitUsd === "number" &&
      m.analysis.netProfitUsd > 0
  );

  lines.push(`Mercados analisados (com resultado): ${withAnalysis.length}`);
  lines.push(`Worthwhile (virariam intent): ${worthwhile.length}`);
  if (positiveNotWorth.length) {
    lines.push(
      `Positivos mas abaixo do mínimo material: ${positiveNotWorth.length}`
    );
  }
  lines.push("");

  if (withAnalysis.length === 0) {
    lines.push("Nenhum mercado com análise OK. Verifique:");
    lines.push("  - RPC_BASE no .env (para sim on-chain em Base)");
    lines.push("  - Erros NO_RPC / UNKNOWN_POOL no painel");
    lines.push("");
    return lines.join("\n");
  }

  lines.push("Resumo por mercado (Base neste scan):");
  for (const m of withAnalysis.slice(0, 12)) {
    const a = m.analysis;
    const tag = a.worthwhile ? "worthwhile" : "não worthwhile";
    const mode = a.onChainRoundtrip
      ? "onchain"
      : a.jupiterRoundtrip
        ? "jupiter"
        : a.aggregatorRoundtrip
          ? "agregador"
          : "modelo";
    const net =
      typeof a.netProfitUsd === "number"
        ? a.netProfitUsd.toFixed(4)
        : "?";
    lines.push(
      `  - ${m.id}: ${tag} · ${mode} · lucro liq. ${net} USD · ${m.label || ""}`
    );
  }
  if (withAnalysis.length > 12) {
    lines.push(`  ... e mais ${withAnalysis.length - 12}`);
  }

  lines.push("");
  lines.push("Para APRENDER (ver intents mesmo com lucro pequeno):");
  lines.push("  No ficheiro .env na pasta do projeto, acrescente:");
  lines.push("  MIN_NET_PROFIT_USD=0");
  lines.push("  RPC_BASE=https://mainnet.base.org");
  lines.push("  (ou URL Alchemy/Infura — ver .env.example)");
  lines.push("");
  lines.push("Depois volte a correr a opção 3 do menu ou:");
  lines.push("  npm run executor:simulate -- --chain=base --learn");
  lines.push("");
  return lines.join("\n");
}

module.exports = { formatNoIntentsHint };
