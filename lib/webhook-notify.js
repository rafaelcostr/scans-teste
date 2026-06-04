/**
 * Notificação HTTP opcional quando existem mercados worthwhile no scan.
 *
 * Env:
 *   WEBHOOK_URL — obrigatório para ativar (salvo ENABLE_WEBHOOK=0)
 *   WEBHOOK_SECRET — HMAC-SHA256 do corpo UTF-8 (X-Webhook-Signature: sha256=…)
 *                    e header legado X-Webhook-Secret com o mesmo valor
 *   WEBHOOK_COOLDOWN_MS (default 90000)
 *   WEBHOOK_MAX_RETRIES — tentativas extra após a primeira (default 5 → até 6 POSTs)
 *   WEBHOOK_RETRY_BACKOFF_MS (default 500) — base do backoff exponencial entre tentativas
 *   WEBHOOK_TIMEOUT_MS (default 12000)
 *   WEBHOOK_MINIMAL_PAYLOAD=1 — omite a lista `intents`; inclui links (paths ou URLs absolutas)
 *   WEBHOOK_PUBLIC_BASE_URL — base pública sem barra final, ex. https://scanner.example.com
 *   WEBHOOK_DEDUPE_FINGERPRINT=1 — não reenviar o mesmo conjunto de oportunidades dentro de WEBHOOK_DEDUPE_WINDOW_MS (default 120000)
 */

const crypto = require("crypto");
const axios = require("axios");
const { sleep } = require("./http-resilience");

let lastWebhookAt = 0;
/** @type {{ fp: string, at: number }} */
let lastWebhookDelivered = { fp: "", at: 0 };

function opportunityFingerprint(scan, good) {
  const ids = good.map((m) => m.id).sort().join(",");
  return `${scan.updatedAt || ""}|${ids}`;
}

function webhookEnabled() {
  if (process.env.ENABLE_WEBHOOK === "0") return false;
  const u = process.env.WEBHOOK_URL;
  return Boolean(u && String(u).trim());
}

function hmacSha256Hex(secret, rawBodyUtf8) {
  return crypto.createHmac("sha256", secret).update(rawBodyUtf8, "utf8").digest("hex");
}

function buildWebhookBody(scan, good, opts) {
  const { eventId, emittedAt, minimal } = opts;
  const pb = String(opts.publicBase || "").trim().replace(/\/$/, "");
  const withBase = (path) => (pb ? `${pb}${path}` : path);

  const intents = Array.isArray(scan.intents) ? scan.intents : [];
  const base = {
    event: "scan_opportunity",
    eventId,
    emittedAt,
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
    }))
  };

  if (minimal) {
    base.intentsCount = intents.length;
    base.links = {
      intents: withBase("/api/intents"),
      scanJsonExport: withBase("/api/scan/export?format=json&useLast=1"),
      scanCsvExport: withBase("/api/scan/export?format=csv&useLast=1"),
      scanLive: withBase("/api/scan")
    };
  } else {
    base.intents = intents;
    base.intentsCount = intents.length;
  }

  return base;
}

function shouldRetryHttpStatus(status) {
  if (status === 429 || status === 408) return true;
  if (status >= 500 && status < 600) return true;
  return false;
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

  const dedupe =
    process.env.WEBHOOK_DEDUPE_FINGERPRINT === "1" ||
    process.env.WEBHOOK_DEDUPE_FINGERPRINT === "true";
  const fp = opportunityFingerprint(scan, good);
  if (dedupe) {
    const win = Math.min(
      3_600_000,
      Math.max(
        5000,
        parseInt(process.env.WEBHOOK_DEDUPE_WINDOW_MS || "120000", 10) || 120000
      )
    );
    if (
      fp === lastWebhookDelivered.fp &&
      Date.now() - lastWebhookDelivered.at < win
    ) {
      return;
    }
  }

  const url = String(process.env.WEBHOOK_URL).trim();
  const secret = process.env.WEBHOOK_SECRET
    ? String(process.env.WEBHOOK_SECRET).trim()
    : "";
  const extraRetries = Math.min(
    20,
    Math.max(0, parseInt(process.env.WEBHOOK_MAX_RETRIES || "5", 10) || 5)
  );
  const totalAttempts = 1 + extraRetries;
  let backoff = Math.min(
    30_000,
    Math.max(50, parseInt(process.env.WEBHOOK_RETRY_BACKOFF_MS || "500", 10) || 500)
  );

  const minimal =
    process.env.WEBHOOK_MINIMAL_PAYLOAD === "1" ||
    process.env.WEBHOOK_MINIMAL_PAYLOAD === "true";
  const publicBase = String(process.env.WEBHOOK_PUBLIC_BASE_URL || "").trim();

  const eventId = crypto.randomUUID();
  const emittedAt = new Date().toISOString();
  const bodyObj = buildWebhookBody(scan, good, {
    eventId,
    emittedAt,
    minimal,
    publicBase
  });

  const rawBody = JSON.stringify(bodyObj);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "DEX_SCANNER/1.1 (webhook)"
  };
  if (secret) {
    const sig = hmacSha256Hex(secret, rawBody);
    headers["X-Webhook-Signature"] = `sha256=${sig}`;
    headers["X-Webhook-Secret"] = secret;
  }

  const timeout = parseInt(process.env.WEBHOOK_TIMEOUT_MS || "12000", 10) || 12000;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    try {
      const res = await axios.post(url, rawBody, {
        timeout,
        headers,
        validateStatus: () => true,
        transformRequest: [(data) => (typeof data === "string" ? data : JSON.stringify(data))]
      });
      if (res.status >= 200 && res.status < 300) {
        lastWebhookAt = Date.now();
        if (dedupe) {
          lastWebhookDelivered = { fp, at: Date.now() };
        }
        return;
      }
      if (!shouldRetryHttpStatus(res.status)) {
        console.warn(
          `[webhook] HTTP ${res.status} sem retry: ${url} eventId=${eventId}`
        );
        lastWebhookAt = Date.now();
        return;
      }
      console.warn(
        `[webhook] HTTP ${res.status} tentativa ${attempt + 1}/${totalAttempts} eventId=${eventId}`
      );
    } catch (e) {
      console.warn(
        `[webhook] rede/timeout tentativa ${attempt + 1}/${totalAttempts}: ${e.message || e} eventId=${eventId}`
      );
    }

    if (attempt < totalAttempts - 1) {
      const wait = Math.min(30_000, backoff * 2 ** attempt);
      await sleep(wait);
    }
  }

  console.warn(`[webhook] esgotadas ${totalAttempts} tentativa(s): ${url} eventId=${eventId}`);
  lastWebhookAt = Date.now();
}

/** Só para testes: repõe cooldown interno. */
function resetWebhookStateForTests() {
  lastWebhookAt = 0;
  lastWebhookDelivered = { fp: "", at: 0 };
}

module.exports = {
  notifyWebhookIfOpportunities,
  webhookEnabled,
  hmacSha256Hex,
  buildWebhookBody,
  resetWebhookStateForTests
};
