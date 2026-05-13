/**
 * Guarda o último resultado de `runScan()` em memória para export sem novo scan.
 * Atualizado pelo servidor após cada `GET /api/scan` bem-sucedido.
 */

let last = null;

function setLastScan(data) {
  if (!data || typeof data !== "object") return;
  last = data;
}

function getLastScan() {
  return last;
}

function clearLastScan() {
  last = null;
}

module.exports = { setLastScan, getLastScan, clearLastScan };
