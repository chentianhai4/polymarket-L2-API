import test from "node:test";
import assert from "node:assert/strict";
import { PolymarketGateway } from "../src/openclaw/polymarket/polymarketGateway.mjs";

function buildResult({ positions = [], activity = [], value = [{ user: "0x", value: 0 }], syncIssues = [] } = {}) {
  return {
    openOrders: [],
    trades: [],
    notifications: [],
    positions,
    activity,
    value,
    sourceStatus: {
      openOrders: "skipped",
      clobTrades: "skipped",
      notifications: "skipped",
      positions: "ok",
      activity: "ok",
      value: "ok",
    },
    syncIssues,
    degraded: syncIssues.length > 0,
    syncedAt: Date.now(),
  };
}

test("syncPositions falls back to funder when requested address is empty", async () => {
  const requestedAddress = "0x1111111111111111111111111111111111111111";
  const funderAddress = "0x2222222222222222222222222222222222222222";
  const calls = [];

  const gatewayLike = {
    clob: {
      funderAddress,
      async getSignerAddress() {
        return requestedAddress;
      },
    },
    positionService: {
      async syncAccountState({ address }) {
        calls.push(address);
        if (address.toLowerCase() === requestedAddress.toLowerCase()) {
          return buildResult({ positions: [], activity: [], value: [{ user: address, value: 0 }] });
        }
        return buildResult({
          positions: [{ proxyWallet: funderAddress, size: 1 }],
          activity: [{ type: "TRADE" }],
          value: [{ user: address, value: 10 }],
        });
      },
    },
  };

  const result = await PolymarketGateway.prototype.syncPositions.call(gatewayLike, {
    address: requestedAddress,
  });

  assert.deepEqual(calls, [requestedAddress, funderAddress]);
  assert.equal(result.addressFallbackApplied, true);
  assert.equal(result.addressRequested, requestedAddress);
  assert.equal(result.addressUsed, funderAddress);
  assert.equal(result.positions.length, 1);
  assert.match(result.syncIssues.at(-1).message, /fallback to funder/i);
});

test("syncPositions uses requested address only when fallback disabled", async () => {
  const requestedAddress = "0x3333333333333333333333333333333333333333";
  const funderAddress = "0x4444444444444444444444444444444444444444";
  const calls = [];

  const gatewayLike = {
    clob: {
      funderAddress,
      async getSignerAddress() {
        return requestedAddress;
      },
    },
    positionService: {
      async syncAccountState({ address }) {
        calls.push(address);
        return buildResult({ positions: [], activity: [], value: [{ user: address, value: 0 }] });
      },
    },
  };

  const result = await PolymarketGateway.prototype.syncPositions.call(gatewayLike, {
    address: requestedAddress,
    useFunderFallback: false,
  });

  assert.deepEqual(calls, [requestedAddress]);
  assert.equal(result.addressFallbackApplied, false);
  assert.equal(result.addressUsed, requestedAddress);
});
