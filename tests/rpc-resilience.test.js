const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  withRpcRetry,
  isRetryableRpcError
} = require("../lib/rpc-resilience.js");

describe("rpc-resilience", () => {
  it("isRetryableRpcError reconhece 429 e mensagens de rate limit", () => {
    assert.equal(isRetryableRpcError(new Error("429 too many requests")), true);
    assert.equal(isRetryableRpcError(new Error("rate limit exceeded")), true);
    assert.equal(isRetryableRpcError(new Error("execution reverted")), false);
  });

  it("withRpcRetry repete até suceder após erros retryable", async () => {
    let n = 0;
    const v = await withRpcRetry(
      async () => {
        n += 1;
        if (n < 3) {
          throw new Error("429 too many requests");
        }
        return 42;
      },
      { maxRetries: 5 }
    );
    assert.equal(v, 42);
    assert.equal(n, 3);
  });

  it("withRpcRetry propaga erro não retryable", async () => {
    await assert.rejects(
      () =>
        withRpcRetry(async () => {
          throw new Error("execution reverted: no data");
        }),
      /execution reverted/
    );
  });
});
