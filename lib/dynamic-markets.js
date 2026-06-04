/**
 * Monta mercados (≥2 DEX no mesmo par) a partir de seeds de tokens + DexScreener.
 * Fonte de seeds: `data/seed-tokens.json` (gerado por `npm run seed:tokens`).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  getDynamicQualityConfig,
  dynamicPairPassesQuality,
  dynamicPairTokenSymbolsPass
} = require("./dynamic-quality");

/** Endereços “majors” por rede (lowercase) — par precisa tocar um destes. */
const MAJOR_BY_CHAIN = {
  arbitrum: new Set([
    "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
    "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8",
    "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
    "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1"
  ]),
  base: new Set([
    "0x4200000000000000000000000000000000000006",
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",
    "0x50c5725949a6f0c72e6c4a641f24049a917db0cb"
  ]),
  optimism: new Set([
    "0x4200000000000000000000000000000000000006",
    "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
    "0x7f5c764cbc14f9669b88837ca1490cca17c31607",
    "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
    "0x94b008aa00579c1307b0ef40c99f3fb3e31caf9c"
  ]),
  polygon: new Set([
    "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
    "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
    "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
    "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
    "0x455e53cbb362cf0a10a75689abbf409e71fbe7f2"
  ]),
  bsc: new Set([
    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    "0x55d398326f99059ff775485246999027b3197955",
    "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    "0x2170ed0880ac9a755fd29b2688956bd959f933f8"
  ]),
  avalanche: new Set([
    "0xb31f66aa3c1e785363f0875a1b74d27b85fe9727",
    "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
    "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7",
    "0x49d5c2bdfdac6ce2bfdb6640f4f80f226bc10bab"
  ]),
  fantom: new Set([
    "0x21be370d5312f0cb14380987eb0884f62f73f866",
    "0x74b23882a302b51a867b9bc655ff72388f2f5130",
    "0x04068da6c83afcaf0e4c03dd807adf3345a1d454",
    "0x8d11ec38a3eb5e956b05250567a3e0dafa1ce7fe"
  ])
};

function seedFilePath() {
  return path.join(__dirname, "..", "data", "seed-tokens.json");
}

function loadSeedByChain() {
  const p = seedFilePath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pairKey(chainId, baseAddr, quoteAddr) {
  const a = baseAddr.toLowerCase();
  const b = quoteAddr.toLowerCase();
  return `${chainId}|${a < b ? `${a}|${b}` : `${b}|${a}`}`;
}

function touchesMajor(chain, baseAddr, quoteAddr) {
  const set = MAJOR_BY_CHAIN[chain];
  if (!set) return false;
  const a = baseAddr.toLowerCase();
  const b = quoteAddr.toLowerCase();
  return set.has(a) || set.has(b);
}

function labelFromPair(p) {
  const x = p.baseToken?.symbol || "?";
  const y = p.quoteToken?.symbol || "?";
  return `${x} / ${y}`;
}

/**
 * @param {import('axios').AxiosInstance} axios
 * @param {{ maxTotal?: number, minLiquidityUsd?: number, batchSize?: number, delayMs?: number }} opts
 */
async function buildDynamicMarkets(axios, opts = {}) {
  const maxTotal = opts.maxTotal ?? 200;
  const minLiq = opts.minLiquidityUsd ?? 2500;
  const batchSize = opts.batchSize ?? 20;
  const delayMs = opts.delayMs ?? 260;
  const qualityCfg = getDynamicQualityConfig();
  const dynamicDefaultFeeBps = parseInt(
    process.env.DYNAMIC_DEFAULT_FEE_BPS ||
      process.env.DEFAULT_SWAP_FEE_BPS ||
      "30",
    10
  );

  const seedByChain = loadSeedByChain();
  if (!seedByChain) return [];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const candidates = [];

  for (const [chain, tokenList] of Object.entries(seedByChain)) {
    if (!Array.isArray(tokenList) || !MAJOR_BY_CHAIN[chain]) continue;

    const groups = new Map();

    for (let i = 0; i < tokenList.length; i += batchSize) {
      const batch = tokenList.slice(i, i + batchSize).filter(Boolean);
      if (batch.length === 0) continue;
      const url = `https://api.dexscreener.com/latest/dex/tokens/${batch.join(",")}`;
      try {
        const res = await axios.get(url, { timeout: 25000 });
        const pairs = res.data.pairs;
        if (!Array.isArray(pairs)) {
          await sleep(delayMs);
          continue;
        }

        for (const p of pairs) {
          if (!p || p.chainId !== chain) continue;
          const liq = Number(p.liquidity?.usd ?? 0);
          if (!Number.isFinite(liq) || liq < minLiq) continue;
          const b = p.baseToken?.address;
          const q = p.quoteToken?.address;
          if (!b || !q) continue;
          if (!touchesMajor(chain, b, q)) continue;
          if (!dynamicPairPassesQuality(p, qualityCfg)) continue;
          if (!dynamicPairTokenSymbolsPass(p.baseToken, p.quoteToken)) continue;

          const k = pairKey(chain, b, q);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push({
            dexId: p.dexId || "unknown",
            pairAddress: p.pairAddress,
            liquidityUsd: liq,
            pair: p
          });
        }
      } catch {
        /* ignora batch com falha */
      }
      await sleep(delayMs);
    }

    for (const [, rows] of groups) {
      const byDex = new Map();
      for (const row of rows) {
        const d = row.dexId;
        const prev = byDex.get(d);
        if (!prev || row.liquidityUsd > prev.liquidityUsd) byDex.set(d, row);
      }
      if (byDex.size < 2) continue;

      const sorted = [...byDex.values()].sort(
        (u, v) => v.liquidityUsd - u.liquidityUsd
      );
      const pick = sorted.slice(0, 2);
      const sample = pick[0].pair;
      const idBase =
        sample.baseToken.address.toLowerCase() +
        sample.quoteToken.address.toLowerCase();
      const short = crypto.createHash("sha256").update(idBase).digest("hex").slice(0, 12);
      const id = `dyn-${chain}-${short}`;

      candidates.push({
        sumLiq: pick[0].liquidityUsd + pick[1].liquidityUsd,
        market: {
          id,
          label: labelFromPair(sample),
          chain,
          dynamic: true,
          note: "Gerado automaticamente (DexScreener + seeds). Confirme sempre o par no explorer.",
          pools: [
            {
              name: `${pick[0].dexId}`,
              pair: pick[0].pairAddress,
              feeBps: dynamicDefaultFeeBps
            },
            {
              name: `${pick[1].dexId}`,
              pair: pick[1].pairAddress,
              feeBps: dynamicDefaultFeeBps
            }
          ]
        }
      });
    }
  }

  candidates.sort((a, b) => b.sumLiq - a.sumLiq);
  return candidates.slice(0, maxTotal).map((c) => c.market);
}

module.exports = {
  buildDynamicMarkets,
  loadSeedByChain,
  seedFilePath
};
