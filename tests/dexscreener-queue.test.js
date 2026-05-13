const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

function loadHr() {
  delete require.cache[require.resolve("../lib/http-resilience.js")];
  return require("../lib/http-resilience.js");
}

afterEach(() => {
  delete process.env.DEXSCREENER_GLOBAL_CONCURRENCY;
  try {
    const hr = loadHr();
    hr.resetDexscreenerQueueForTests();
  } catch {
    /* ignore */
  }
});

describe("fila global DexScreener (FIFO)", () => {
  it("com DEXSCREENER_GLOBAL_CONCURRENCY=1 só um GET Dex em voo de cada vez", async () => {
    process.env.DEXSCREENER_GLOBAL_CONCURRENCY = "1";
    const hr = loadHr();
    let active = 0;
    let maxActive = 0;
    const axiosMock = {
      get: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 25));
        active -= 1;
        return { data: { ok: true }, status: 200 };
      }
    };
    const u1 =
      "https://api.dexscreener.com/latest/dex/pairs/ethereum/0x0000000000000000000000000000000000000001";
    const u2 =
      "https://api.dexscreener.com/latest/dex/pairs/ethereum/0x0000000000000000000000000000000000000002";
    await Promise.all([
      hr.axiosGetWithCacheAndRetry(axiosMock, u1, { ttlMs: 1 }),
      hr.axiosGetWithCacheAndRetry(axiosMock, u2, { ttlMs: 1 })
    ]);
    assert.equal(maxActive, 1);
  });

  it("URLs que não são DexScreener não usam a fila (podem sobrepor)", async () => {
    process.env.DEXSCREENER_GLOBAL_CONCURRENCY = "1";
    const hr = loadHr();
    let active = 0;
    let maxActive = 0;
    const axiosMock = {
      get: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 15));
        active -= 1;
        return { data: {}, status: 200 };
      }
    };
    await Promise.all([
      hr.axiosGetWithCacheAndRetry(axiosMock, "https://example.com/a", {
        ttlMs: 1
      }),
      hr.axiosGetWithCacheAndRetry(axiosMock, "https://example.com/b", {
        ttlMs: 1
      })
    ]);
    assert.ok(maxActive >= 2);
  });

  it("DEXSCREENER_GLOBAL_CONCURRENCY=2 permite dois GET Dex em paralelo", async () => {
    process.env.DEXSCREENER_GLOBAL_CONCURRENCY = "2";
    const hr = loadHr();
    let active = 0;
    let maxActive = 0;
    const axiosMock = {
      get: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active -= 1;
        return { data: { ok: true }, status: 200 };
      }
    };
    const urls = [
      "https://api.dexscreener.com/latest/dex/pairs/ethereum/0x0000000000000000000000000000000000000001",
      "https://api.dexscreener.com/latest/dex/pairs/ethereum/0x0000000000000000000000000000000000000002",
      "https://api.dexscreener.com/latest/dex/pairs/ethereum/0x0000000000000000000000000000000000000003"
    ];
    await Promise.all(
      urls.map((u) => hr.axiosGetWithCacheAndRetry(axiosMock, u, { ttlMs: 1 }))
    );
    assert.equal(maxActive, 2);
  });
});
