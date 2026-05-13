/**
 * Erros CoinGecko: sink por mercado (`{ coingecko: { errors, lastError } }`)
 * ou, sem sink, o diagnóstico global ligado com `attach`.
 */

let attached = null;

function attach(diag) {
  attached = diag;
}

function detach() {
  attached = null;
}

/**
 * @param {string} message
 * @param {{ coingecko?: { errors?: number, lastError?: string | null } } | null} [sink] — diagnóstico do mercado (scanner)
 */
function cgError(message, sink) {
  const target = sink?.coingecko ?? attached?.coingecko;
  if (!target) return;
  target.errors = (target.errors || 0) + 1;
  target.lastError = String(message || "erro");
}

module.exports = { attach, detach, cgError };
