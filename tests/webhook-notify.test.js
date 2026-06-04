const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const crypto = require("crypto");

function loadWebhookFresh() {
  delete require.cache[require.resolve("../lib/webhook-notify.js")];
  delete require.cache[require.resolve("../lib/http-resilience.js")];
  return require("../lib/webhook-notify.js");
}

describe("webhook-notify", () => {
  it("hmacSha256Hex coincide com receptor esperado", () => {
    const { hmacSha256Hex } = loadWebhookFresh();
    const raw = '{"a":1}';
    const sec = "testsecret_testsecret_min8";
    const h = hmacSha256Hex(sec, raw);
    const ref = crypto.createHmac("sha256", sec).update(raw, "utf8").digest("hex");
    assert.equal(h, ref);
  });

  it("buildWebhookBody minimal inclui links e intentsCount", () => {
    const { buildWebhookBody } = loadWebhookFresh();
    const scan = {
      updatedAt: "2026-01-02T00:00:00.000Z",
      params: { scanDurationMs: 10 },
      intents: [{ marketId: "x" }]
    };
    const good = [
      {
        id: "m1",
        chain: "base",
        label: "L",
        analysis: {
          worthwhile: true,
          netProfitUsd: 2,
          spreadPercent: 0.1,
          onChainRoundtrip: false
        }
      }
    ];
    const b = buildWebhookBody(scan, good, {
      eventId: "evt-1",
      emittedAt: "2026-01-02T00:00:01.000Z",
      minimal: true,
      publicBase: "https://example.com"
    });
    assert.equal(b.eventId, "evt-1");
    assert.equal(b.intentsCount, 1);
    assert.equal(b.links.intents, "https://example.com/api/intents");
    assert.ok(!Object.prototype.hasOwnProperty.call(b, "intents"));
  });
});

describe("webhook-notify HTTP retries", () => {
  let server;
  let port;
  let hits = 0;
  const secret = "testsecret_testsecret_min8";

  before(() => {
    server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
      });
      req.on("end", () => {
        hits += 1;
        const sig = req.headers["x-webhook-signature"];
        const expected =
          "sha256=" +
          crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
        if (sig !== expected) {
          res.writeHead(401);
          res.end("bad sig");
          return;
        }
        if (hits < 2) {
          res.writeHead(503);
          res.end("no");
        } else {
          res.writeHead(200);
          res.end("ok");
        }
      });
    });
    return new Promise((resolve, reject) => {
      server.listen(0, "127.0.0.1", (err) => (err ? reject(err) : resolve()));
    }).then(() => {
      port = server.address().port;
    });
  });

  after(() => {
    for (const k of [
      "WEBHOOK_URL",
      "WEBHOOK_SECRET",
      "WEBHOOK_MAX_RETRIES",
      "WEBHOOK_RETRY_BACKOFF_MS",
      "WEBHOOK_COOLDOWN_MS"
    ]) {
      delete process.env[k];
    }
    delete require.cache[require.resolve("../lib/webhook-notify.js")];
    delete require.cache[require.resolve("../lib/http-resilience.js")];
    return new Promise((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
  });

  it("repete POST até 200 e mantém o mesmo corpo (HMAC)", async () => {
    process.env.WEBHOOK_URL = `http://127.0.0.1:${port}`;
    process.env.WEBHOOK_SECRET = secret;
    process.env.WEBHOOK_MAX_RETRIES = "5";
    process.env.WEBHOOK_RETRY_BACKOFF_MS = "5";
    process.env.WEBHOOK_COOLDOWN_MS = "0";
    delete process.env.ENABLE_WEBHOOK;
    delete process.env.WEBHOOK_MINIMAL_PAYLOAD;
    delete process.env.WEBHOOK_PUBLIC_BASE_URL;

    hits = 0;
    const mod = loadWebhookFresh();
    mod.resetWebhookStateForTests();

    const scan = {
      updatedAt: "2026-03-01T12:00:00.000Z",
      params: { scanDurationMs: 5 },
      markets: [
        {
          id: "arb-x",
          chain: "arbitrum",
          label: "T",
          analysis: {
            worthwhile: true,
            netProfitUsd: 3,
            spreadPercent: 0.2,
            onChainRoundtrip: true
          }
        }
      ],
      intents: []
    };

    await mod.notifyWebhookIfOpportunities(scan);
    assert.equal(hits, 2);
  });
});
