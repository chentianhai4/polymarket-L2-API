import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRealtimeEvent } from "../src/openclaw/polymarket/ws/eventNormalizer.mjs";

test("normalizeRealtimeEvent handles new price_change format", () => {
  const event = normalizeRealtimeEvent({
    event_type: "price_change",
    payload: {
      timestamp: 1,
      changes: [{ tokenId: "123", price: "0.45", best_bid: "0.44", best_ask: "0.46" }],
    },
  });

  assert.equal(event.type, "price_change");
  assert.equal(event.payload.changes[0].tokenId, "123");
  assert.equal(event.payload.changes[0].price, 0.45);
});

test("normalizeRealtimeEvent handles legacy price_change format", () => {
  const event = normalizeRealtimeEvent({
    event_type: "price_change",
    asset_id: "456",
    price: "0.22",
  });

  assert.equal(event.type, "price_change");
  assert.equal(event.payload.changes[0].tokenId, "456");
  assert.equal(event.payload.changes[0].price, 0.22);
});
