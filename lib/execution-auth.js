/**
 * Autenticação das rotas /api/executor/* (só no servidor).
 * Header: X-Executor-Key ou Authorization: Bearer <EXECUTOR_API_KEY>
 */

function executorApiConfigured() {
  const k = process.env.EXECUTOR_API_KEY;
  return Boolean(k && String(k).trim());
}

function executorKillSwitch() {
  return (
    process.env.EXECUTOR_KILL_SWITCH === "1" ||
    process.env.EXECUTOR_KILL_SWITCH === "true"
  );
}

function getProvidedExecutorKey(req) {
  const h = req.header("x-executor-key");
  if (h && String(h).trim()) return String(h).trim();
  const auth = req.header("authorization");
  if (auth && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, "").trim();
  }
  return "";
}

/**
 * Express middleware: 503 se API não configurada; 403 kill-switch; 401 chave errada.
 */
function requireExecutorAuth(req, res, next) {
  const expected =
    process.env.EXECUTOR_API_KEY && String(process.env.EXECUTOR_API_KEY).trim();
  if (!expected) {
    res.status(503).json({
      error:
        "Executor API desligada. Defina EXECUTOR_API_KEY no servidor (nunca no browser)."
    });
    return;
  }
  if (executorKillSwitch()) {
    res.status(403).json({ error: "EXECUTOR_KILL_SWITCH ativo — enqueue/tick bloqueados." });
    return;
  }
  const got = getProvidedExecutorKey(req);
  if (got !== expected) {
    res.status(401).json({ error: "Chave de executor inválida ou em falta." });
    return;
  }
  next();
}

module.exports = {
  executorApiConfigured,
  executorKillSwitch,
  requireExecutorAuth,
  getProvidedExecutorKey
};
