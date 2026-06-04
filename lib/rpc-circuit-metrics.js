/**
 * Métricas leves por endpoint RPC (por rede + índice na lista de URLs) e
 * circuit breaker opcional: após N falhas consecutivas, o endpoint falha
 * rápido durante um cooldown (o ethers FallbackProvider tenta o seguinte).
 *
 * Env:
 *   RPC_CIRCUIT_BREAKER — 0/false = só métricas, sem abrir circuito (default 1)
 *   RPC_CB_FAILURE_THRESHOLD — falhas seguidas para trip (default 4, min 2)
 *   RPC_CB_COOLDOWN_MS — ms em “open” (default 45000, mínimo 100)
 */

"use strict";

function circuitBreakerEnabled() {
  const e = process.env.RPC_CIRCUIT_BREAKER;
  if (e === "0" || e === "false") return false;
  return true;
}

function parseThreshold() {
  const n = parseInt(process.env.RPC_CB_FAILURE_THRESHOLD || "4", 10);
  if (!Number.isFinite(n)) return 4;
  return Math.min(50, Math.max(2, n));
}

function parseCooldownMs() {
  const n = parseInt(process.env.RPC_CB_COOLDOWN_MS || "45000", 10);
  if (!Number.isFinite(n)) return 45_000;
  return Math.min(600_000, Math.max(100, n));
}

/** @type {Map<string, { consecutiveFailures: number, openUntil: number, callsOk: number, callsErr: number, totalLatencyOkMs: number, lastErr: string | null }>} */
const stateByKey = new Map();

function stateKey(chain, idx) {
  return `${String(chain).toLowerCase()}|${idx}`;
}

function getBucket(chain, idx) {
  const k = stateKey(chain, idx);
  if (!stateByKey.has(k)) {
    stateByKey.set(k, {
      consecutiveFailures: 0,
      openUntil: 0,
      callsOk: 0,
      callsErr: 0,
      totalLatencyOkMs: 0,
      lastErr: null
    });
  }
  return stateByKey.get(k);
}

/**
 * @param {string} chain
 * @param {number} idx
 */
function assertCircuitClosed(chain, idx) {
  if (!circuitBreakerEnabled()) return;
  const s = getBucket(chain, idx);
  const now = Date.now();
  if (s.openUntil && now < s.openUntil) {
    const e = new Error(
      `RPC circuit open for ${chain} endpoint #${idx + 1}; cooldown até ${new Date(s.openUntil).toISOString()}.`
    );
    e.code = "RPC_CIRCUIT_OPEN";
    throw e;
  }
  if (s.openUntil && now >= s.openUntil) {
    s.openUntil = 0;
  }
}

/**
 * @param {string} chain
 * @param {number} idx
 * @param {number} latencyMs
 */
function onRpcSuccess(chain, idx, latencyMs) {
  const s = getBucket(chain, idx);
  s.consecutiveFailures = 0;
  s.openUntil = 0;
  s.callsOk += 1;
  s.totalLatencyOkMs += Math.max(0, latencyMs);
}

/**
 * @param {string} chain
 * @param {number} idx
 * @param {unknown} err
 */
function onRpcFailure(chain, idx, err) {
  const s = getBucket(chain, idx);
  s.callsErr += 1;
  s.lastErr =
    err && typeof err === "object" && "shortMessage" in err
      ? String(err.shortMessage)
      : err && typeof err === "object" && "message" in err
        ? String(err.message)
        : String(err || "");
  if (!circuitBreakerEnabled()) return;
  s.consecutiveFailures += 1;
  const th = parseThreshold();
  if (s.consecutiveFailures >= th) {
    s.openUntil = Date.now() + parseCooldownMs();
    s.consecutiveFailures = 0;
  }
}

/**
 * Resumo agregado por rede (sem expor URLs — só contagens e latência média em calls OK).
 * @param {string[]} chains
 * @returns {Record<string, { callsOk: number, callsErr: number, meanLatencyOkMs: number | null, endpointsCircuitOpen: number, circuitBreaker: boolean }>}
 */
function buildRpcHealthSummary(chains) {
  const out = {};
  const cb = circuitBreakerEnabled();
  for (const ch of chains) {
    const c = String(ch).toLowerCase();
    let callsOk = 0;
    let callsErr = 0;
    let totalLatency = 0;
    let endpointsCircuitOpen = 0;
    for (const [k, s] of stateByKey) {
      if (!k.startsWith(`${c}|`)) continue;
      callsOk += s.callsOk;
      callsErr += s.callsErr;
      totalLatency += s.totalLatencyOkMs;
      if (s.openUntil && Date.now() < s.openUntil) endpointsCircuitOpen += 1;
    }
    const meanLatencyOkMs =
      callsOk > 0 ? Math.round(totalLatency / callsOk) : null;
    out[c] = {
      callsOk,
      callsErr,
      meanLatencyOkMs,
      endpointsCircuitOpen,
      circuitBreaker: cb
    };
  }
  return out;
}

function resetRpcCircuitMetricsForTests() {
  stateByKey.clear();
}

module.exports = {
  assertCircuitClosed,
  onRpcSuccess,
  onRpcFailure,
  buildRpcHealthSummary,
  resetRpcCircuitMetricsForTests,
  circuitBreakerEnabled
};
