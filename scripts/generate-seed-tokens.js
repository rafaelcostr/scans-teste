/**
 * Gera `data/seed-tokens.json` com até 200 endereços por rede,
 * a partir da lista oficial Uniswap (tokens com bridgeInfo para cada chain),
 * mais `EXTRA_SEEDS` (ex.: Polygon POL / WMATIC / DeFi blue-chips).
 *
 * Uso: node scripts/generate-seed-tokens.js
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const DEX_CHAINS = {
  "42161": "arbitrum",
  "8453": "base",
  "10": "optimism",
  "137": "polygon",
  "56": "bsc",
  "43114": "avalanche",
  "250": "fantom"
};

const MAX_PER_CHAIN = 200;

/** Endereços nativos / fortes por rede que não vêm do bridgeInfo Uniswap (merge ao gerar). */
const EXTRA_SEEDS = {
  polygon: [
    "0x455e53CBB362cF0a10a75689aBBF409E71fbE7f2",
    "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39",
    "0xb33EaAd8d922B1083446DC23f610c2567fB5180f",
    "0xD6DF932A45C0f255f85145f286eA0b292B21C90B",
    "0x172370d5Cd63279eFa6d502DAB29171933a610AF",
    "0x5fe2B58c013d7601147DcdD68C143A77499f5531",
    "0xA1c57f48F0Deb89f569dFbE6E2B7f46D33606fD4",
    "0x50B728D8D964fd00C2d0AAD81718b71311feF68a",
    "0x0b3F08E57fB001Cb6257Ab254B558c6d6bEeD69e",
    "0x831753DD7087CaC61aB5644b308642cc1c33Ff13",
    "0xdF7837DE1F2Fa4631D716CF2502f8b230F1dcc32",
    "0xBBba073C31bf03b8ACf7C28EF6038Dac839F7562",
    "0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590",
    "0x6e4E624106Cb12E168E6533F8ec7c82263358940"
  ]
};

async function main() {
  const res = await axios.get("https://tokens.uniswap.org/", { timeout: 60000 });
  const tokens = res.data.tokens;
  if (!Array.isArray(tokens)) {
    throw new Error("Lista Uniswap inválida");
  }

  const byDex = {};
  for (const cid of Object.keys(DEX_CHAINS)) {
    byDex[cid] = new Set();
  }

  for (const t of tokens) {
    const b = t.extensions?.bridgeInfo;
    if (!b || typeof b !== "object") continue;
    for (const [cidStr, info] of Object.entries(b)) {
      if (!DEX_CHAINS[cidStr] || !info?.tokenAddress) continue;
      const addr = String(info.tokenAddress).trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) continue;
      byDex[cidStr].add(addr);
    }
  }

  const out = {};
  for (const [cid, slug] of Object.entries(DEX_CHAINS)) {
    const set = new Set([...(byDex[cid] || [])]);
    const extras = EXTRA_SEEDS[slug];
    if (extras) {
      for (const a of extras) {
        const addr = String(a).trim();
        if (/^0x[a-fA-F0-9]{40}$/.test(addr)) {
          set.add(addr);
        }
      }
    }
    const list = [...set].slice(0, MAX_PER_CHAIN);
    out[slug] = list;
    console.log(`${slug}: ${list.length} tokens`);
  }

  const dir = path.join(__dirname, "..", "data");
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, "seed-tokens.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`\nEscrito: ${outPath}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
