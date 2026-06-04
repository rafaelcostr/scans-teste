const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  intentDedupeKey,
  enqueueIntents,
  getQueueState,
  peekNextPending,
  resetExecutionQueueForTests
} = require("../lib/execution-queue.js");

function sampleIntent(overrides = {}) {
  return {
    marketId: "m-1",
    chain: "base",
    mode: "model",
    scanUpdatedAt: "2026-01-01T00:00:00.000Z",
    netProfitUsd: 1,
    ...overrides
  };
}

describe("execution-queue", () => {
  beforeEach(() => {
    resetExecutionQueueForTests();
  });

  afterEach(() => {
    resetExecutionQueueForTests();
    delete process.env.EXECUTOR_QUEUE_MAX;
  });

  it("intentDedupeKey junta marketId, chain, mode e scanUpdatedAt", () => {
    const k = intentDedupeKey(sampleIntent());
    assert.equal(k, "m-1|base|model|2026-01-01T00:00:00.000Z");
  });

  it("enqueueIntents ignora intent sem marketId", () => {
    const r = enqueueIntents([{ chain: "base", mode: "model" }]);
    assert.equal(r.added, 0);
    assert.equal(r.skipped, 1);
    assert.equal(getQueueState().total, 0);
  });

  it("não duplica pending com mesma dedupe key", () => {
    const a = sampleIntent();
    const r1 = enqueueIntents([a]);
    const r2 = enqueueIntents([{ ...a }]);
    assert.equal(r1.added, 1);
    assert.equal(r2.added, 0);
    assert.equal(r2.skipped, 1);
    assert.equal(getQueueState().pending, 1);
  });

  it("permite segundo job com mesma marketId se scanUpdatedAt diferir", () => {
    enqueueIntents([sampleIntent({ scanUpdatedAt: "2026-01-01T00:00:00.000Z" })]);
    const r = enqueueIntents([
      sampleIntent({ scanUpdatedAt: "2026-01-01T00:00:01.000Z" })
    ]);
    assert.equal(r.added, 1);
    assert.equal(getQueueState().pending, 2);
  });

  it("respeita EXECUTOR_QUEUE_MAX", () => {
    process.env.EXECUTOR_QUEUE_MAX = "2";
    const r = enqueueIntents([
      sampleIntent({ marketId: "a" }),
      sampleIntent({ marketId: "b" }),
      sampleIntent({ marketId: "c" })
    ]);
    assert.equal(r.added, 2);
    assert.equal(r.dropped, 1);
    assert.equal(peekNextPending().intent.marketId, "a");
  });
});
