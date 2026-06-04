/**
 * JsonRpcProvider com métricas + circuit breaker (ver rpc-circuit-metrics.js).
 */

"use strict";

const { JsonRpcProvider } = require("ethers");
const {
  assertCircuitClosed,
  onRpcSuccess,
  onRpcFailure
} = require("../rpc-circuit-metrics");

class InstrumentedJsonRpcProvider extends JsonRpcProvider {
  /**
   * @param {string} url
   * @param {string} chainSlug
   * @param {number} endpointIndex
   */
  constructor(url, chainSlug, endpointIndex) {
    super(url);
    this._instrumentChain = String(chainSlug).toLowerCase();
    this._instrumentIdx = endpointIndex;
  }

  /**
   * @param {import("ethers").JsonRpcPayload | import("ethers").JsonRpcPayload[]} payload
   */
  async _send(payload) {
    assertCircuitClosed(this._instrumentChain, this._instrumentIdx);
    const t0 = Date.now();
    try {
      const r = await super._send(payload);
      onRpcSuccess(this._instrumentChain, this._instrumentIdx, Date.now() - t0);
      return r;
    } catch (e) {
      onRpcFailure(this._instrumentChain, this._instrumentIdx, e);
      throw e;
    }
  }
}

module.exports = { InstrumentedJsonRpcProvider };
