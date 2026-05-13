/**
 * GET com cache TTL + retries (429 / 5xx) para DexScreener e afins.
 * Env: HTTP_CACHE_TTL_MS (default 20000), HTTP_MAX_RETRIES (default 4)
 *
 * Pedidos a `api.dexscreener.com` passam por uma **fila global FIFO**
 * (concorrência `DEXSCREENER_GLOBAL_CONCURRENCY`, default 1 = estritamente um de cada vez).
 * Acertos de cache não entram na fila.
 */

const httpCache = new Map();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isDexscreenerUrl(url) {
  try {
    return String(url).toLowerCase().includes("api.dexscreener.com");
  } catch {
    return false;
  }
}

/**
 * Fila global: ordem FIFO, até `concurrency` tarefas em paralelo.
 */
class GlobalFifoQueue {
  constructor(concurrency) {
    this.concurrency = Math.max(1, concurrency);
    this.active = 0;
    /** @type {{ task: () => Promise<unknown>, resolve: (v: unknown) => void, reject: (e: unknown) => void }[]} */
    this.pending = [];
  }

  run(task) {
    return new Promise((resolve, reject) => {
      this.pending.push({ task, resolve, reject });
      this.drain();
    });
  }

  drain() {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const item = this.pending.shift();
      this.active += 1;
      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}

let dexscreenerQueue = null;

function getDexscreenerQueue() {
  if (!dexscreenerQueue) {
    const c = parseInt(
      process.env.DEXSCREENER_GLOBAL_CONCURRENCY ?? "1",
      10
    );
    dexscreenerQueue = new GlobalFifoQueue(
      Number.isFinite(c) && c > 0 ? c : 1
    );
  }
  return dexscreenerQueue;
}

/** Só para testes: volta a ler `DEXSCREENER_GLOBAL_CONCURRENCY` no próximo pedido. */
function resetDexscreenerQueueForTests() {
  dexscreenerQueue = null;
}

async function axiosGetWithCacheAndRetry(axios, url, options = {}) {
  const ttlMs = parseInt(
    options.ttlMs ?? process.env.HTTP_CACHE_TTL_MS ?? "20000",
    10
  );
  const maxRetries = parseInt(
    options.maxRetries ?? process.env.HTTP_MAX_RETRIES ?? "4",
    10
  );
  const timeout = options.timeout ?? 25000;
  const cache = options.cache ?? httpCache;

  const hit = cache.get(url);
  if (hit && Date.now() < hit.exp) {
    return { data: hit.data, status: 200, cached: true };
  }

  const performHttp = async () => {
    let lastErr;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await axios.get(url, {
          timeout,
          validateStatus: () => true,
          ...options.axiosConfig
        });
        if (res.status === 429) {
          const wait = Math.min(8000, 400 * 2 ** attempt);
          await sleep(wait);
          lastErr = new Error("HTTP 429 Too Many Requests");
          continue;
        }
        if (res.status >= 500) {
          lastErr = new Error(`HTTP ${res.status}`);
          await sleep(300 * 2 ** attempt);
          continue;
        }
        if (res.status >= 400) {
          throw new Error(`HTTP ${res.status}`);
        }
        cache.set(url, { exp: Date.now() + ttlMs, data: res.data });
        return { data: res.data, status: res.status, cached: false };
      } catch (e) {
        lastErr = e;
        if (attempt < maxRetries - 1) {
          await sleep(250 * 2 ** attempt);
        }
      }
    }
    throw lastErr || new Error("Falha HTTP após retries");
  };

  if (isDexscreenerUrl(url)) {
    return getDexscreenerQueue().run(performHttp);
  }
  return performHttp();
}

/** Objeto mínimo compatível com `axios.get` para quem só usa GET. */
function wrapAxiosGet(axiosInstance, defaults = {}) {
  return {
    get: (url, config = {}) =>
      axiosGetWithCacheAndRetry(axiosInstance, url, { ...defaults, axiosConfig: config })
  };
}

module.exports = {
  axiosGetWithCacheAndRetry,
  wrapAxiosGet,
  sleep,
  httpCache,
  getDexscreenerQueue,
  resetDexscreenerQueueForTests,
  isDexscreenerUrl
};
