import test from "node:test";
import assert from "node:assert/strict";
import { PolymarketGateway } from "../src/openclaw/polymarket/polymarketGateway.mjs";

function parseTokenIds(market) {
  const direct = market?.clobTokenIds ?? market?.clob_token_ids;
  if (Array.isArray(direct)) return direct.map(String);

  if (typeof direct === "string" && direct.trim()) {
    try {
      const parsed = JSON.parse(direct);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // ignore
    }
  }

  if (Array.isArray(market?.tokens)) {
    return market.tokens
      .map((token) => token?.id ?? token?.token_id ?? token?.tokenId)
      .filter(Boolean)
      .map(String);
  }

  return [];
}

function roundToTick(value, tickSize) {
  const tick = Number(tickSize);
  if (!Number.isFinite(tick) || tick <= 0) return Number(value);
  return Math.max(tick, Math.round(Number(value) / tick) * tick);
}

test("live small order smoke (guarded)", { timeout: 120000 }, async (t) => {
  if (process.env.LIVE_TRADING !== "1") {
    t.skip("Set LIVE_TRADING=1 to run live smoke test");
    return;
  }

  if (!process.env.PRIVATE_KEY || !process.env.FUNDER_ADDRESS) {
    t.skip("Missing PRIVATE_KEY or FUNDER_ADDRESS");
    return;
  }

  const gateway = new PolymarketGateway({
    privateKey: process.env.PRIVATE_KEY,
    funderAddress: process.env.FUNDER_ADDRESS,
    signatureType: Number(process.env.SIGNATURE_TYPE ?? "2"),
    apiKey: process.env.API_KEY,
    secret: process.env.SECRET,
    passphrase: process.env.PASSPHRASE,
    auditLogPath: "./audit/live-smoke.log",
  });

  await gateway.initialize({ autoAuth: true });

  const markets = await gateway.discoverMarkets({ limit: 25, active: true });
  assert.ok(Array.isArray(markets) && markets.length > 0, "No live markets discovered");

  const market = markets.find((item) => parseTokenIds(item).length > 0);
  assert.ok(market, "No market with tradable token found");

  const tokenId = parseTokenIds(market)[0];
  assert.ok(tokenId, "Missing tokenId");

  const quote = await gateway.getQuote({ tokenId, side: "BUY" });
  const tickSize = Number(quote?.tickSize ?? quote?.orderBook?.tick_size ?? 0.01);
  const minSize = Number(quote?.orderBook?.min_order_size ?? 1);
  const bestPrice = Number(quote?.price?.price ?? quote?.midpoint?.mid ?? quote?.midpoint?.midpoint ?? 0.5);

  const buyPrice = Math.min(0.99, roundToTick(Math.max(tickSize, bestPrice - tickSize * 5), tickSize));
  const maxNotional = Number(process.env.MAX_TEST_NOTIONAL_USD ?? "5");
  const candidateSize = Number((maxNotional / Math.max(buyPrice, tickSize)).toFixed(4));
  const size = Math.max(minSize, candidateSize);

  const intent = {
    tokenId,
    conditionId: market.conditionId ?? market.condition_id,
    side: "BUY",
    orderType: "LIMIT",
    size,
    limitPrice: buyPrice,
    timeInForce: "GTC",
    postOnly: true,
  };

  const precheck = await gateway.precheckOrder(intent, {
    skillId: "live-smoke",
    idempotencyKey: `live-smoke:${tokenId}`,
  });

  assert.notEqual(precheck.riskDecision.effectiveAction, "BLOCK", "Risk engine blocked live smoke order");

  const placed = await gateway.placeOrder(intent, {
    skillId: "live-smoke",
    idempotencyKey: `live-smoke:${tokenId}:${Date.now()}`,
  });

  assert.equal(placed.accepted, true, "Order was not accepted");
  assert.ok(Array.isArray(placed.orderIds) && placed.orderIds.length > 0, "No order id returned");

  const cancelPayload = { orderID: placed.orderIds[0] };
  const canceled = await gateway.cancel(cancelPayload);
  assert.ok(canceled, "Cancel request returned empty payload");

  const openOrders = await gateway.syncOrders({});
  assert.ok(openOrders !== undefined, "syncOrders returned undefined");
});
