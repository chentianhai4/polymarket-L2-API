import test from "node:test";
import assert from "node:assert/strict";
import { buildPolymarketMcpTools } from "../src/openclaw/polymarket/mcp/tools.mjs";

function getTool(tools, name) {
  const tool = tools.find((x) => x.name === name);
  assert.ok(tool, `tool not found: ${name}`);
  return tool;
}

function buildGatewayMock() {
  const calls = {
    initialize: 0,
    precheckOrder: 0,
    placeOrder: 0,
    batchPlaceOrders: 0,
    cancel: 0,
  };

  const gateway = {
    calls,
    async initialize() {
      calls.initialize += 1;
      return { signer: "0xabc", chainId: 137 };
    },
    async precheckOrder(intent) {
      calls.precheckOrder += 1;
      return {
        intent,
        riskDecision: {
          decision: "ALLOW",
          effectiveAction: "CONTINUE",
          reasonCodes: [],
          requiredActions: [],
        },
      };
    },
    async placeOrder() {
      calls.placeOrder += 1;
      return { accepted: true };
    },
    async batchPlaceOrders() {
      calls.batchPlaceOrders += 1;
      return { accepted: true };
    },
    async cancel() {
      calls.cancel += 1;
      return { canceled: true };
    },
  };

  return gateway;
}

test("trade tools return DRY_RUN and do not execute live paths", async () => {
  const gateway = buildGatewayMock();
  const tools = buildPolymarketMcpTools({ gateway });
  const intent = {
    tokenId: "1",
    side: "BUY",
    orderType: "LIMIT",
    size: 1,
    limitPrice: 0.5,
    timeInForce: "GTC",
    postOnly: true,
  };

  const place = await getTool(tools, "pm_order_place").execute({ intent, dryRun: true });
  assert.equal(place.data.dryRun, true);
  assert.equal(place.data.finalStatus, "DRY_RUN");
  assert.equal(place.data.accepted, true);

  const batch = await getTool(tools, "pm_order_batch_place").execute({
    intents: [intent, { ...intent, tokenId: "2" }],
    dryRun: true,
  });
  assert.equal(batch.data.dryRun, true);
  assert.equal(batch.data.finalStatus, "DRY_RUN");
  assert.equal(batch.data.preview.intentsCount, 2);
  assert.equal(batch.data.preview.blockedCount, 0);

  const cancel = await getTool(tools, "pm_order_cancel").execute({
    payload: { all: true },
    dryRun: true,
  });
  assert.equal(cancel.data.dryRun, true);
  assert.equal(cancel.data.finalStatus, "DRY_RUN");

  const cancelAll = await getTool(tools, "pm_order_cancel_all").execute({ dryRun: true });
  assert.equal(cancelAll.data.dryRun, true);
  assert.equal(cancelAll.data.finalStatus, "DRY_RUN");

  assert.equal(gateway.calls.placeOrder, 0);
  assert.equal(gateway.calls.batchPlaceOrders, 0);
  assert.equal(gateway.calls.cancel, 0);
  assert.equal(gateway.calls.precheckOrder, 3);
});
