const path = require("path");
const fs = require("fs");
const express = require("express");
const { runScan } = require("./scanner");
const { getPublicConfig } = require("./lib/public-config");
const { appendScan } = require("./lib/scan-history");
const { scanToCsv, scanToJson } = require("./lib/scan-export");
const { setLastScan, getLastScan } = require("./lib/last-scan-cache");
const { notifyWebhookIfOpportunities } = require("./lib/webhook-notify");
const { validateEnvOnStartup } = require("./lib/env-validate");

const envIssues = validateEnvOnStartup();
for (const w of envIssues.warnings) {
  console.warn(`[env] ${w}`);
}
if (envIssues.errors.length > 0) {
  for (const e of envIssues.errors) {
    console.error(`[env] ${e}`);
  }
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.json({ limit: "512kb" }));

const { mountExecutorRoutes } = require("./lib/execution-routes");
mountExecutorRoutes(app, { getLastScan });

app.get("/api/config", (_req, res) => {
  try {
    res.json(getPublicConfig());
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/env-example", (_req, res) => {
  const p = path.join(__dirname, ".env.example");
  fs.readFile(p, "utf8", (err, txt) => {
    if (err) {
      res.status(404).type("text/plain").send("Ficheiro .env.example não encontrado.");
      return;
    }
    res.type("text/plain; charset=utf-8").send(txt);
  });
});

app.get("/api/intents", (_req, res) => {
  try {
    const data = getLastScan();
    if (!data) {
      return res.json({
        intents: [],
        updatedAt: null,
        hint: "Ainda não há scan em cache. Aguarde o painel (GET /api/scan) ou chame /api/scan uma vez."
      });
    }
    res.json({
      intents: data.intents || [],
      updatedAt: data.updatedAt
    });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/history", async (req, res) => {
  try {
    const { readHistory } = require("./lib/scan-history");
    const marketId =
      req.query.marketId && String(req.query.marketId).trim()
        ? String(req.query.marketId).trim()
        : undefined;
    const limitRaw = req.query.limit;
    const limit =
      limitRaw != null && String(limitRaw).trim() !== ""
        ? parseInt(String(limitRaw), 10)
        : 120;
    const points = await readHistory({ marketId, limit });
    res.json({ points, updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/scan/export", async (req, res) => {
  try {
    const fmt = (req.query.format || "json").toLowerCase();
    const useLast =
      req.query.useLast === "1" || req.query.useLast === "true";
    let data = useLast ? getLastScan() : null;
    if (!data) {
      data = await runScan();
    }
    const stamp = (data.updatedAt || new Date().toISOString()).replace(
      /[:.]/g,
      "-"
    );
    if (fmt === "csv") {
      const csv = scanToCsv(data);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="dex-scan-${stamp}.csv"`
      );
      return res.send(csv);
    }
    const json = scanToJson(data);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="dex-scan-${stamp}.json"`
    );
    return res.send(json);
  } catch (e) {
    res.status(500).json({
      error: e.message || String(e),
      updatedAt: new Date().toISOString()
    });
  }
});

app.get("/api/scan", async (_req, res) => {
  try {
    const data = await runScan();
    setLastScan(data);
    if (process.env.ENABLE_SCAN_HISTORY !== "0") {
      appendScan(data).catch(() => {});
    }
    notifyWebhookIfOpportunities(data).catch(() => {});
    res.json(data);
  } catch (e) {
    res.status(500).json({
      error: e.message || String(e),
      updatedAt: new Date().toISOString()
    });
  }
});

app.use(express.static(path.join(__dirname, "public")));

const server = app.listen(PORT, () => {
  console.log(`Painel: http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(
      `Porta ${PORT} já está em uso. Feche o outro servidor Node ou use outra porta, por exemplo:\n` +
        `  $env:PORT = "3001"; npm start`
    );
    process.exit(1);
  }
  throw err;
});
