/**
 * Simulação didática de execução — sem MetaMask, sem saldo, sem enviar transações.
 *
 * Modos:
 *   node scripts/executor-simulate.js --chain=base
 *     → corre um scan só nessa rede (precisa RPC_<REDE> para sim on-chain)
 *
 *   node scripts/executor-simulate.js --from-server
 *     → usa último scan do servidor (npm start noutro terminal)
 *
 *   node scripts/executor-simulate.js --chain=base --market-id=base-weth-usdc
 *
 *   node scripts/executor-simulate.js --chain=base --learn
 *     → MIN_NET_PROFIT_USD=0 só nesta execução (ver intents mais facil)
 */

const axios = require("axios");
const { runScan } = require("../scanner");
const { buildIntentsFromScan } = require("../lib/scan-intents");
const { formatNoIntentsHint } = require("../lib/scan-no-intents-hint");
const {
  runPaperSimulation,
  formatPaperSimReport
} = require("../lib/executor-paper-sim");

function parseArgs(argv) {
  const out = {
    chain: null,
    marketId: null,
    fromServer: false,
    snapshotOnly: false,
    learn: false
  };
  for (const a of argv) {
    if (a === "--from-server") out.fromServer = true;
    if (a === "--snapshot-only") out.snapshotOnly = true;
    if (a === "--learn") out.learn = true;
    if (a.startsWith("--chain=")) out.chain = a.slice("--chain=".length).toLowerCase();
    if (a.startsWith("--market-id=")) {
      out.marketId = a.slice("--market-id=".length).trim();
    }
  }
  return out;
}

async function fetchScanFromServer() {
  const base = (
    process.env.EXECUTOR_BASE_URL ||
    `http://127.0.0.1:${process.env.PORT || "3000"}`
  ).replace(/\/$/, "");
  const res = await axios.get(`${base}/api/scan`, {
    timeout: 600000,
    validateStatus: () => true
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      res.data?.error ||
        `GET /api/scan falhou (${res.status}). Servidor a correr? (npm start)`
    );
  }
  return res.data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.learn) {
    process.env.MIN_NET_PROFIT_USD = "0";
    console.log("Modo --learn: MIN_NET_PROFIT_USD=0 (aceita lucro líquido > 0 USD).");
  }

  console.log("");
  console.log("Modo PAPER: não vais gastar gas nem precisas de USDC/ETH na carteira.");
  console.log("Para re-simular on-chain (eth_call), define RPC na rede (ex. RPC_BASE no .env).");
  console.log("");

  let scan;
  if (args.fromServer) {
    console.log("A obter último scan do servidor…");
    scan = await fetchScanFromServer();
  } else {
    const chain = args.chain;
    if (!chain) {
      console.error(
        "Indique --chain=base (ou outra) ou use --from-server com npm start."
      );
      process.exit(1);
    }
    console.log(`A correr scan (só ${chain})… isto pode demorar um minuto.`);
    scan = await runScan({ targetChain: chain });
    if (scan.error) {
      console.error(scan.error);
      process.exit(1);
    }
  }

  const intents = buildIntentsFromScan(scan);
  if (intents.length === 0) {
    console.error("Nenhum intent worthwhile neste scan.");
    console.log(formatNoIntentsHint(scan));
    process.exit(1);
  }

  let intent;
  if (args.marketId) {
    intent = intents.find((i) => i.marketId === args.marketId);
    if (!intent) {
      console.error(`Intent não encontrado para market-id=${args.marketId}`);
      console.error("Disponíveis:", intents.map((i) => i.marketId).join(", "));
      process.exit(1);
    }
  } else {
    intent =
      intents.find((i) => i.mode === "onchain") ||
      intents[0];
    console.log(
      `A simular o primeiro intent (${intent.mode}): ${intent.marketId} — use --market-id= para outro.`
    );
  }

  const report = await runPaperSimulation(scan, intent, {
    refreshOnChain: !args.snapshotOnly
  });

  console.log(formatPaperSimReport(report));

  if (process.env.EXECUTOR_SIM_JSON === "1") {
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
