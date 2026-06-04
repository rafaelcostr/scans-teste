/**
 * Validação leve de variáveis de ambiente no arranque do servidor.
 * Erros críticos → process.exit(1); avisos → consola apenas.
 */

function num(name, def) {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function int(name, def) {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") return def;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateEnvOnStartup() {
  const errors = [];
  const warnings = [];

  const port = int("PORT", 3000);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    errors.push(`PORT inválido: defina um inteiro entre 1 e 65535 (recebido: ${process.env.PORT})`);
  }

  const scanUiPoll = int("SCAN_UI_POLL_MS", 15000);
  if (
    process.env.SCAN_UI_POLL_MS != null &&
    String(process.env.SCAN_UI_POLL_MS).trim() !== "" &&
    (!Number.isFinite(scanUiPoll) || scanUiPoll < 5000)
  ) {
    warnings.push(
      `SCAN_UI_POLL_MS recomendado >= 5000 ms (recebido: ${process.env.SCAN_UI_POLL_MS})`
    );
  }

  const notional = num("NOTIONAL_USD", 200);
  if (!Number.isFinite(notional) || notional <= 0) {
    errors.push(`NOTIONAL_USD deve ser um número > 0 (recebido: ${process.env.NOTIONAL_USD})`);
  }

  const slip = int("SLIPPAGE_BPS", 20);
  if (!Number.isFinite(slip) || slip < 0 || slip > 10_000) {
    warnings.push(`SLIPPAGE_BPS fora do intervalo típico 0–10000 (recebido: ${process.env.SLIPPAGE_BPS})`);
  }

  const scanPar = int("SCAN_PARALLEL", 6);
  if (!Number.isFinite(scanPar) || scanPar < 1) {
    warnings.push(`SCAN_PARALLEL deve ser ≥ 1 (recebido: ${process.env.SCAN_PARALLEL})`);
  }

  const maxDyn = int("MAX_DYNAMIC_MARKETS", 200);
  if (!Number.isFinite(maxDyn) || maxDyn < 0) {
    warnings.push(`MAX_DYNAMIC_MARKETS inválido: ${process.env.MAX_DYNAMIC_MARKETS}`);
  }

  const histMax = int("HISTORY_MAX_SCANS", 200);
  if (!Number.isFinite(histMax) || histMax < 1) {
    warnings.push(`HISTORY_MAX_SCANS deve ser ≥ 1 (recebido: ${process.env.HISTORY_MAX_SCANS})`);
  }

  const webhookUrl = process.env.WEBHOOK_URL && String(process.env.WEBHOOK_URL).trim();
  if (webhookUrl) {
    try {
      const u = new URL(webhookUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        errors.push(`WEBHOOK_URL deve ser http(s): ${webhookUrl}`);
      }
    } catch {
      errors.push(`WEBHOOK_URL não é um URL válido: ${webhookUrl}`);
    }
  }

  const webhookRetries = int("WEBHOOK_MAX_RETRIES", 5);
  if (!Number.isFinite(webhookRetries) || webhookRetries < 0 || webhookRetries > 20) {
    warnings.push(`WEBHOOK_MAX_RETRIES recomendado entre 0 e 20 (recebido: ${process.env.WEBHOOK_MAX_RETRIES})`);
  }

  const backoff = int("WEBHOOK_RETRY_BACKOFF_MS", 500);
  if (!Number.isFinite(backoff) || backoff < 50) {
    warnings.push(`WEBHOOK_RETRY_BACKOFF_MS muito baixo ou inválido: ${process.env.WEBHOOK_RETRY_BACKOFF_MS}`);
  }

  const publicBase =
    process.env.WEBHOOK_PUBLIC_BASE_URL && String(process.env.WEBHOOK_PUBLIC_BASE_URL).trim();
  if (
    (process.env.WEBHOOK_MINIMAL_PAYLOAD === "1" ||
      process.env.WEBHOOK_MINIMAL_PAYLOAD === "true") &&
    !publicBase
  ) {
    warnings.push(
      "WEBHOOK_MINIMAL_PAYLOAD=1 sem WEBHOOK_PUBLIC_BASE_URL: os links no JSON serão só paths (/api/…); defina a base pública se o consumidor precisar de URLs absolutas."
    );
  }

  if (publicBase) {
    try {
      const u = new URL(publicBase);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        warnings.push(`WEBHOOK_PUBLIC_BASE_URL deve ser http(s): ${publicBase}`);
      }
    } catch {
      warnings.push(`WEBHOOK_PUBLIC_BASE_URL inválido: ${publicBase}`);
    }
  }

  const secret = process.env.WEBHOOK_SECRET && String(process.env.WEBHOOK_SECRET).trim();
  if (secret && secret.length < 8) {
    warnings.push(
      "WEBHOOK_SECRET muito curto (< 8 caracteres). Para produção use um segredo longo e aleatório."
    );
  }

  const intentsMin = process.env.INTENTS_MIN_NET_USD;
  if (intentsMin != null && String(intentsMin).trim() !== "") {
    const x = Number(intentsMin);
    if (!Number.isFinite(x) || x < 0) {
      warnings.push(`INTENTS_MIN_NET_USD inválido: ${intentsMin}`);
    }
  }

  const stallRpc = int("RPC_FALLBACK_STALL_MS", 750);
  if (
    process.env.RPC_FALLBACK_STALL_MS != null &&
    String(process.env.RPC_FALLBACK_STALL_MS).trim() !== "" &&
    (!Number.isFinite(stallRpc) || stallRpc < 50)
  ) {
    warnings.push(
      `RPC_FALLBACK_STALL_MS recomendado ≥ 50 ms (recebido: ${process.env.RPC_FALLBACK_STALL_MS})`
    );
  }

  const cbTh = int("RPC_CB_FAILURE_THRESHOLD", 4);
  if (
    process.env.RPC_CB_FAILURE_THRESHOLD != null &&
    String(process.env.RPC_CB_FAILURE_THRESHOLD).trim() !== "" &&
    (!Number.isFinite(cbTh) || cbTh < 2 || cbTh > 50)
  ) {
    warnings.push(
      `RPC_CB_FAILURE_THRESHOLD use inteiro 2–50 (recebido: ${process.env.RPC_CB_FAILURE_THRESHOLD})`
    );
  }

  const cbCool = int("RPC_CB_COOLDOWN_MS", 45000);
  if (
    process.env.RPC_CB_COOLDOWN_MS != null &&
    String(process.env.RPC_CB_COOLDOWN_MS).trim() !== "" &&
    (!Number.isFinite(cbCool) || cbCool < 100 || cbCool > 600_000)
  ) {
    warnings.push(
      `RPC_CB_COOLDOWN_MS use 100–600000 ms (recebido: ${process.env.RPC_CB_COOLDOWN_MS})`
    );
  }

  const qsb = process.env.QUOTE_SIM_BLOCK_TAG && String(process.env.QUOTE_SIM_BLOCK_TAG).trim();
  if (qsb) {
    const ok =
      /^(latest|pending|safe|finalized|earliest)$/i.test(qsb) ||
      /^0x[0-9a-f]+$/i.test(qsb) ||
      /^\d+$/.test(qsb);
    if (!ok) {
      warnings.push(
        `QUOTE_SIM_BLOCK_TAG não reconhecido (use latest|pending|safe|finalized|número|0x…): ${qsb}`
      );
    }
  }

  const aps = process.env.AGGREGATOR_POLYGON_STABLE && String(process.env.AGGREGATOR_POLYGON_STABLE).trim();
  if (aps && !/^0x[a-fA-F0-9]{40}$/.test(aps)) {
    warnings.push(
      `AGGREGATOR_POLYGON_STABLE deve ser 0x + 40 hex (checksume opcional): ${aps}`
    );
  }

  const apd = process.env.AGGREGATOR_POLYGON_STABLE_DECIMALS;
  if (apd != null && String(apd).trim() !== "") {
    const d = parseInt(String(apd), 10);
    if (!Number.isFinite(d) || d < 1 || d > 36) {
      warnings.push(`AGGREGATOR_POLYGON_STABLE_DECIMALS inválido: ${apd}`);
    }
  }

  const exKey = process.env.EXECUTOR_API_KEY && String(process.env.EXECUTOR_API_KEY).trim();
  if (exKey && exKey.length < 16) {
    warnings.push(
      "EXECUTOR_API_KEY muito curto; use ≥16 caracteres aleatórios em produção."
    );
  }

  const riskNonNegative = [
    "RISK_MAX_NOTIONAL_USD",
    "RISK_MIN_NET_PROFIT_USD",
    "RISK_MIN_PROFIT_BUFFER_USD",
    "RISK_MAX_SLIPPAGE_BPS",
    "RISK_MAX_QUOTE_AGE_SEC"
  ];
  for (const name of riskNonNegative) {
    if (process.env[name] != null && String(process.env[name]).trim() !== "") {
      const x = Number(process.env[name]);
      if (!Number.isFinite(x) || x < 0) {
        warnings.push(`${name} deve ser um número >= 0 (recebido: ${process.env[name]})`);
      }
    }
  }

  const paperInterval = int("PAPER_LOOP_INTERVAL_MS", 15000);
  if (
    process.env.PAPER_LOOP_INTERVAL_MS != null &&
    String(process.env.PAPER_LOOP_INTERVAL_MS).trim() !== "" &&
    (!Number.isFinite(paperInterval) || paperInterval < 5000)
  ) {
    warnings.push(
      `PAPER_LOOP_INTERVAL_MS recomendado >= 5000 ms (recebido: ${process.env.PAPER_LOOP_INTERVAL_MS})`
    );
  }

  return { errors, warnings };
}

module.exports = { validateEnvOnStartup };
