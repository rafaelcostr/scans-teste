/**
 * Receptor HTTP mínimo para testar o webhook do HUNTER scanner.
 *
 * Terminal A (receptor):
 *   set WEBHOOK_RECEIVER_SECRET=hunter
 *   set RECEIVER_PORT=3333
 *   node scripts/webhook-echo-receiver.js
 *
 * Terminal B (scanner) — .env ou PowerShell:
 *   WEBHOOK_URL=http://127.0.0.1:3333/hunter
 *   WEBHOOK_SECRET=hunter
 *   WEBHOOK_COOLDOWN_MS=0
 *
 * Depois dispare um scan com oportunidade (GET /api/scan no painel ou curl).
 * O corpo JSON inclui event, markets, intents (lista filtrada por INTENTS_*).
 *
 * npm run webhook:echo — atalho com porta default 3333.
 */

const http = require("http");

const PORT = parseInt(process.env.RECEIVER_PORT || "3333", 10);
const SHARED = process.env.WEBHOOK_RECEIVER_SECRET || "";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw.trim()) {
          resolve(null);
          return;
        }
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Use POST (ex.: /hunter)\n");
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("JSON inválido\n");
    return;
  }

  if (SHARED) {
    const got = String(req.headers["x-webhook-secret"] || "");
    if (got !== SHARED) {
      res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("X-Webhook-Secret incorreto ou em falta\n");
      return;
    }
  }

  const stamp = new Date().toISOString();
  console.log(`\n========== ${stamp} ${req.method} ${req.url} ==========`);
  console.log(JSON.stringify(body, null, 2));
  if (body && Array.isArray(body.intents)) {
    console.log(`[intents] ${body.intents.length} entrada(s)`);
  }

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: true, receivedAt: stamp }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `Webhook echo em http://127.0.0.1:${PORT}/ (qualquer path POST).` +
      (SHARED ? ` Secret ativo (WEBHOOK_RECEIVER_SECRET).` : " Sem verificação de secret.")
  );
});
