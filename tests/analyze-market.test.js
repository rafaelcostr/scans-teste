const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { analyzeMarket, liquidityImpactUsd } = require("../scanner.js");

function row(dex, price, overrides = {}) {
  return {
    dex,
    price,
    feeBps: overrides.feeBps ?? 30,
    feeSource: overrides.feeSource ?? "default",
    liquidityUsd: overrides.liquidityUsd ?? null,
    gasUsdTx: overrides.gasUsdTx ?? null,
    pool: { chain: "arbitrum", name: dex, ...(overrides.pool || {}) }
  };
}

describe("analyzeMarket", () => {
  it("compra no menor preço e vende no maior", () => {
    const a = analyzeMarket("Teste", "arbitrum", [
      row("Alto", 102),
      row("Médio", 101),
      row("Baixo", 100)
    ]);
    assert.equal(a.buyDex, "Baixo");
    assert.equal(a.sellDex, "Alto");
    assert.ok(Number.isFinite(a.spreadPercent));
    assert.ok(a.grossProfitUsd > 0);
  });

  it("usa modo bps quando não há liquidez para impacto", () => {
    const a = analyzeMarket("X", "polygon", [
      row("A", 1, { liquidityUsd: null }),
      row("B", 1.01, { liquidityUsd: null })
    ]);
    assert.equal(a.slippageMode, "bps");
    assert.ok(a.slippageUsd > 0);
  });
});

describe("liquidityImpactUsd", () => {
  it("retorna null sem liquidez", () => {
    assert.equal(liquidityImpactUsd(200, null), null);
  });

  it("cresce com notional relativamente à liquidez", () => {
    const a = liquidityImpactUsd(200, 1e6);
    const b = liquidityImpactUsd(200, 1e4);
    assert.ok(b > a);
  });
});
