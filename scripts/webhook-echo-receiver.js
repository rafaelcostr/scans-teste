/**
 * Receptor HTTP mínimo para testar o webhook do scanner.
 *
 * Terminal A (receptor):
 *   set WEBHOOK_RECEIVER_SECRET=changeme
 *   set RECEIVER_PORT=3333
 *   node scripts/webhook-echo-receiver.js
 *
 * Terminal B (scanner) — .env ou PowerShell:
 *   WEBHOOK_URL=http://127.0.0.1:3333/webhook
 *   WEBHOOK_SECRET=changeme
 *   WEBHOOK_COOLDOWN_MS=0
 *
 * Verificação: se o pedido trouxer X-Webhook-Signature: sha256=…, valida HMAC do
 * corpo bruto com WEBHOOK_RECEIVER_SECRET. Caso contrário, usa X-Webhook-Secret (legado).
 *
 * npm run webhook:echo — atalho com porta default 3333.
 */

const http = require("http");
const crypto = require("crypto");

const PORT = parseInt(process.env.RECEIVER_PORT || "3333", 10);
const SHARED = process.env.WEBHOOK_RECEIVER_SECRET || "";

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function verifySignature(rawBody, sigHeader) {
  if (!SHARED || !sigHeader) return false;
  const m = /^sha256=([a-f0-9]{64})$/i.exec(String(sigHeader).trim());
  if (!m) return false;
  let theirs;
  try {
    theirs = Buffer.from(m[1], "hex");
  } catch {
    return false;
  }
  const ours = crypto.createHmac("sha256", SHARED).update(rawBody, "utf8").digest();
  if (theirs.length !== ours.length) return false;
  return crypto.timingSafeEqual(theirs, ours);
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Use POST (ex.: /webhook)\n");
    return;
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (e) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Erro ao ler corpo: ${e.message || e}\n`);
    return;
  }

  const sig = req.headers["x-webhook-signature"];
  const legacy = req.headers["x-webhook-secret"];

  if (SHARED) {
    if (sig) {
      if (!verifySignature(raw, sig)) {
        res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("X-Webhook-Signature incorreto ou em falta\n");
        return;
      }
    } else if (legacy !== SHARED) {
      res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("X-Webhook-Secret incorreto ou em falta\n");
      return;
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { raw: raw.slice(0, 500) };
  }

  console.log(`[webhook-echo] ${new Date().toISOString()} ${req.url}`);
  console.log(JSON.stringify(parsed, null, 2));

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: true, receivedAt: new Date().toISOString() }));
});

server.listen(PORT, () => {
  console.log(`Webhook echo em http://127.0.0.1:${PORT}/webhook`);
  if (SHARED) {
    console.log("Segredo configurado (WEBHOOK_RECEIVER_SECRET).");
  } else {
    console.log("Sem WEBHOOK_RECEIVER_SECRET — aceita qualquer POST.");
  }
});
