/**
 * Notificação HTTP opcional quando existem mercados worthwhile no scan.
 *
 * Env: WEBHOOK_URL (obrigatório para ativar), ENABLE_WEBHOOK=0 para desligar,
 *      WEBHOOK_COOLDOWN_MS (default 90000), WEBHOOK_SECRET (header X-Webhook-Secret)
 */

const axios = require("axios");

let lastWebhookAt = 0;

function webhookEnabled() {
  if (process.env.ENABLE_WEBHOOK === "0") return false;
  const u = process.env.WEBHOOK_URL;
  return Boolean(u && String(u).trim());
}

/**
 * @param {object} scan — saída de runScan()
 */
async function notifyWebhookIfOpportunities(scan) {
  if (!webhookEnabled()) return;
  const cooldown = parseInt(process.env.WEBHOOK_COOLDOWN_MS || "90000", 10);
  const now = Date.now();
  if (now - lastWebhookAt < cooldown) return;

  const good = (scan.markets || []).filter(
    (m) => m.analysis && m.analysis.worthwhile && !m.error && !m.disabled
  );
  if (good.length === 0) return;

  lastWebhookAt = now;
  const url = String(process.env.WEBHOOK_URL).trim();
  const body = {
    event: "hunter_opportunity",
    updatedAt: scan.updatedAt,
    scanDurationMs: scan.params?.scanDurationMs ?? null,
    count: good.length,
    markets: good.map((m) => ({
      id: m.id,
      chain: m.chain,
      label: m.label,
      dynamic: Boolean(m.dynamic),
      netProfitUsd: m.analysis.netProfitUsd,
      spreadPercent: m.analysis.spreadPercent,
      mode: m.analysis.onChainRoundtrip ? "onchain" : "model"
    })),
    // Mesmo conteúdo que GET /api/intents (já com INTENTS_* aplicados).
    intents: Array.isArray(scan.intents) ? scan.intents : [],
    intentsCount: Array.isArray(scan.intents) ? scan.intents.length : 0
  };
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "HUNTER_SCANNER/1.0 (webhook)"
  };
  if (process.env.WEBHOOK_SECRET) {
    headers["X-Webhook-Secret"] = String(process.env.WEBHOOK_SECRET);
  }
  const res = await axios.post(url, body, {
    timeout: 12000,
    headers,
    validateStatus: () => true
  });
  if (res.status < 200 || res.status >= 300) {
    console.warn(`[webhook] HTTP ${res.status} ${url}`);
  }
}

module.exports = { notifyWebhookIfOpportunities, webhookEnabled };
