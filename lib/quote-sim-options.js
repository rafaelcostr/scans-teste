/**
 * Opções opcionais de bloco para eth_call / estimateGas (aproximação “mais próxima” do estado).
 *
 * Env: QUOTE_SIM_BLOCK_TAG — omitir ou `latest` = default do nó;
 *   `pending` | `safe` | `finalized` | número decimal | `0x…` (altura em hex)
 */

"use strict";

/**
 * @returns {{ blockTag?: string | number }}
 */
function getQuoteSimBlockOverrides() {
  const raw = process.env.QUOTE_SIM_BLOCK_TAG;
  if (raw == null || String(raw).trim() === "") return {};
  const s = String(raw).trim().toLowerCase();
  if (s === "latest") return {};
  if (
    s === "pending" ||
    s === "safe" ||
    s === "finalized" ||
    s === "earliest"
  ) {
    return { blockTag: s };
  }
  if (/^0x[0-9a-f]+$/i.test(s)) {
    return { blockTag: s };
  }
  const n = parseInt(s, 10);
  if (Number.isFinite(n) && n >= 0) return { blockTag: n };
  return {};
}

module.exports = { getQuoteSimBlockOverrides };
