import test from "node:test";
import assert from "node:assert/strict";
import { PolymarketGateway } from "../src/openclaw/polymarket/polymarketGateway.mjs";

test("syncOrders injects maker_address from funder when params are empty", async () => {
  const funderAddress = "0x2222222222222222222222222222222222222222";
  const signerAddress = "0x3333333333333333333333333333333333333333";
  const calls = [];

  const gatewayLike = {
    clob: {
      funderAddress,
      async getSignerAddress() {
        return signerAddress;
      },
      async getOpenOrders(params) {
        calls.push(params);
        return [];
      },
    },
  };

  await PolymarketGateway.prototype.syncOrders.call(gatewayLike, {});

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { maker_address: funderAddress });
});

test("syncTrades injects address from funder when params are empty", async () => {
  const funderAddress = "0x4444444444444444444444444444444444444444";
  const signerAddress = "0x5555555555555555555555555555555555555555";
  const calls = [];

  const gatewayLike = {
    clob: {
      funderAddress,
      async getSignerAddress() {
        return signerAddress;
      },
    },
    positionService: {
      async syncTrades(params) {
        calls.push(params);
        return { clobTrades: [], dataApiTrades: [] };
      },
    },
  };

  await PolymarketGateway.prototype.syncTrades.call(gatewayLike, {});

  assert.equal(calls.length, 1);
  assert.equal(calls[0].address, funderAddress);
});
