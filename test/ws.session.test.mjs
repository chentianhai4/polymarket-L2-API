import test from "node:test";
import assert from "node:assert/strict";
import EventEmitter from "node:events";
import { WsSessionManager } from "../src/openclaw/polymarket/ws/sessionManager.mjs";
import { ValidationError } from "../src/openclaw/polymarket/errors.mjs";

class FakeWsClient extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
  }

  async connect() {
    this.connected = true;
    this.emit("connected", { ok: true });
  }

  async disconnect() {
    this.connected = false;
    this.emit("disconnected", { ok: true });
  }
}

test("ws session manager subscribe -> poll -> unsubscribe", async () => {
  const clients = new Map();
  const manager = new WsSessionManager({
    clientFactory: ({ sessionId }) => {
      const client = new FakeWsClient();
      clients.set(sessionId, client);
      return client;
    },
  });

  const subscribed = await manager.subscribe({
    channel: "market",
    subscription: { assets_ids: ["1"] },
  });
  const client = clients.get(subscribed.sessionId);
  client.emit("event", { type: "book", payload: { tokenId: "1" } });

  const polled = await manager.poll({
    sessionId: subscribed.sessionId,
    maxEvents: 10,
  });
  assert.equal(polled.events.length, 1);
  assert.equal(polled.events[0].type, "book");

  const closed = await manager.unsubscribe({ sessionId: subscribed.sessionId });
  assert.equal(closed.closed, true);

  await assert.rejects(async () => {
    await manager.poll({ sessionId: subscribed.sessionId });
  }, ValidationError);
});

test("ws session manager tracks queue overflow drop count", async () => {
  const clients = new Map();
  const manager = new WsSessionManager({
    clientFactory: ({ sessionId }) => {
      const client = new FakeWsClient();
      clients.set(sessionId, client);
      return client;
    },
    maxQueue: 2,
  });

  const subscribed = await manager.subscribe({
    channel: "market",
    subscription: {},
  });
  const client = clients.get(subscribed.sessionId);
  client.emit("event", { id: 1 });
  client.emit("event", { id: 2 });
  client.emit("event", { id: 3 });

  const polled = await manager.poll({ sessionId: subscribed.sessionId, maxEvents: 10 });
  assert.equal(polled.events.length, 2);
  assert.equal(polled.stats.droppedCount, 1);
});

test("ws session manager expires sessions by ttl", async () => {
  const clients = new Map();
  let now = 0;
  const manager = new WsSessionManager({
    clientFactory: ({ sessionId }) => {
      const client = new FakeWsClient();
      clients.set(sessionId, client);
      return client;
    },
    nowFn: () => now,
    ttlMs: 100,
  });

  const subscribed = await manager.subscribe({
    channel: "user",
    subscription: {},
  });
  assert.ok(clients.get(subscribed.sessionId));

  now = 200;
  const cleaned = await manager.cleanupExpired();
  assert.equal(cleaned, 1);

  await assert.rejects(async () => {
    await manager.poll({ sessionId: subscribed.sessionId });
  }, ValidationError);
});
