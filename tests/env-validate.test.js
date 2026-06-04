const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

function loadFresh() {
  delete require.cache[require.resolve("../lib/env-validate.js")];
  return require("../lib/env-validate.js");
}

describe("env-validate", () => {
  const saved = {};

  beforeEach(() => {
    for (const k of [
      "PORT",
      "NOTIONAL_USD",
      "WEBHOOK_URL",
      "WEBHOOK_MAX_RETRIES",
      "WEBHOOK_MINIMAL_PAYLOAD",
      "WEBHOOK_PUBLIC_BASE_URL"
    ]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete require.cache[require.resolve("../lib/env-validate.js")];
  });

  it("sem erros com env mínimo", () => {
    process.env.NOTIONAL_USD = "200";
    const { validateEnvOnStartup } = loadFresh();
    const r = validateEnvOnStartup();
    assert.equal(r.errors.length, 0);
  });

  it("PORT fora do intervalo → erro", () => {
    process.env.PORT = "999999";
    process.env.NOTIONAL_USD = "100";
    const { validateEnvOnStartup } = loadFresh();
    const r = validateEnvOnStartup();
    assert.ok(r.errors.some((e) => e.includes("PORT")));
  });

  it("WEBHOOK_URL inválido → erro", () => {
    process.env.NOTIONAL_USD = "50";
    process.env.WEBHOOK_URL = "ftp://x.com/h";
    const { validateEnvOnStartup } = loadFresh();
    const r = validateEnvOnStartup();
    assert.ok(r.errors.some((e) => e.includes("WEBHOOK_URL")));
  });

  it("NOTIONAL_USD <= 0 → erro", () => {
    process.env.NOTIONAL_USD = "0";
    const { validateEnvOnStartup } = loadFresh();
    const r = validateEnvOnStartup();
    assert.ok(r.errors.some((e) => e.includes("NOTIONAL_USD")));
  });
});
