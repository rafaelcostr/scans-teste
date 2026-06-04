/**
 * Retries para erros típicos de JSON-RPC / gateway (rate limit, 429, throttling).
 * Env: RPC_MAX_RETRIES (default 5)
 */

const { sleep } = require("./http-resilience");

function isRetryableRpcError(err) {
  if (!err) return false;
  if (err.code === "RPC_CIRCUIT_OPEN") return false;
  const msg = String(
    err.shortMessage || err.message || err.reason || err || ""
  ).toLowerCase();
  const nested = err?.error || err?.info?.error;
  const nestedMsg = nested?.message ? String(nested.message).toLowerCase() : "";
  const combined = `${msg} ${nestedMsg}`;
  const code = err?.code ?? nested?.code;
  if (typeof code === "number") {
    if (code === -32005 || code === -32016 || code === -32029) return true;
  }
  if (code === "SERVER_ERROR" && /429|rate|limit|throttl/i.test(combined)) {
    return true;
  }
  return /429|too many requests|rate limit|exceeded|throttl|quota|over relay|request limit|max requests/i.test(
    combined
  );
}

async function withRpcRetry(fn, options = {}) {
  const max = parseInt(
    options.maxRetries ?? process.env.RPC_MAX_RETRIES ?? "5",
    10
  );
  let last;
  for (let i = 0; i < max; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isRetryableRpcError(e) || i === max - 1) {
        throw e;
      }
      await sleep(Math.min(12000, 350 * 2 ** i));
    }
  }
  throw last;
}

module.exports = { withRpcRetry, isRetryableRpcError };
