import { randomUUID } from "node:crypto";
import { ValidationError } from "../errors.mjs";
import { WsChannelClient } from "./channelClient.mjs";

const ALLOWED_CHANNELS = new Set(["market", "user", "sports"]);

function toPositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function toNonNegativeInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.floor(num);
}

export class WsSessionManager {
  constructor({
    gateway = undefined,
    clientFactory = undefined,
    maxSessions = 20,
    maxQueue = 500,
    ttlMs = 15 * 60 * 1000,
    connectTimeoutMs = undefined,
    nowFn = () => Date.now(),
  } = {}) {
    this.gateway = gateway;
    this.clientFactory = clientFactory ?? (({ channel }) => this.buildDefaultClient(channel));
    this.maxSessions = toPositiveInt(maxSessions, 20);
    this.maxQueue = toPositiveInt(maxQueue, 500);
    this.ttlMs = toPositiveInt(ttlMs, 15 * 60 * 1000);
    this.connectTimeoutMs = toPositiveInt(connectTimeoutMs, toPositiveInt(gateway?.config?.requestTimeoutMs, 15000));
    this.nowFn = nowFn;

    this.sessions = new Map();
    this.latestSessionId = null;
    this.latestByChannel = new Map();
  }

  buildDefaultClient(channel) {
    if (!this.gateway) {
      throw new ValidationError("gateway is required when clientFactory is not provided");
    }
    return new WsChannelClient({
      config: this.gateway.config,
      clobService: this.gateway.clob,
      metrics: this.gateway.metrics,
    });
  }

  assertChannel(channel) {
    if (!ALLOWED_CHANNELS.has(channel)) {
      throw new ValidationError(`Unsupported ws channel: ${channel}`);
    }
  }

  now() {
    return this.nowFn();
  }

  touch(session) {
    const now = this.now();
    session.updatedAt = now;
    session.expiresAt = now + session.ttlMs;
  }

  sessionStats(session) {
    return {
      connected: session.connected,
      queued: session.queue.length,
      droppedCount: session.droppedCount,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt,
      lastEventAt: session.lastEventAt,
      lastPollAt: session.lastPollAt,
      lastError: session.lastError,
      ttlMs: session.ttlMs,
      maxQueue: session.maxQueue,
    };
  }

  wakeWaiters(session) {
    if (!Array.isArray(session.waiters) || session.waiters.length === 0) return;
    const waiters = session.waiters.splice(0, session.waiters.length);
    for (const waiter of waiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  enqueueEvent(session, event) {
    while (session.queue.length >= session.maxQueue) {
      session.queue.shift();
      session.droppedCount += 1;
    }
    session.queue.push(event);
    session.lastEventAt = this.now();
    this.touch(session);
    this.wakeWaiters(session);
  }

  bindClientEvents(session) {
    const client = session.client;
    if (!client || typeof client.on !== "function") return;

    client.on("connected", () => {
      session.connected = true;
      this.touch(session);
      this.wakeWaiters(session);
    });

    client.on("disconnected", () => {
      session.connected = false;
      this.touch(session);
      this.wakeWaiters(session);
    });

    client.on("event", (event) => {
      this.enqueueEvent(session, event);
    });

    client.on("error", (error) => {
      session.lastError = error?.message ?? String(error);
      this.enqueueEvent(session, {
        type: "ws_error",
        payload: {
          message: session.lastError,
        },
        receivedAt: this.now(),
      });
    });
  }

  resolveSessionId(sessionId, channel = undefined) {
    if (sessionId && sessionId !== "auto") return String(sessionId);
    if (channel && this.latestByChannel.has(channel)) return this.latestByChannel.get(channel);
    return this.latestSessionId;
  }

  getLatestSessionId(channel = undefined) {
    return this.resolveSessionId(undefined, channel) ?? null;
  }

  async subscribe({ channel, subscription = {}, ttlMs = undefined, maxQueue = undefined } = {}) {
    await this.cleanupExpired();
    this.assertChannel(channel);

    if (this.sessions.size >= this.maxSessions) {
      throw new ValidationError(`Max ws sessions reached: ${this.maxSessions}`);
    }

    const id = randomUUID();
    const session = {
      id,
      channel,
      subscription,
      queue: [],
      droppedCount: 0,
      connected: false,
      lastEventAt: null,
      lastPollAt: null,
      lastError: null,
      createdAt: this.now(),
      updatedAt: this.now(),
      expiresAt: this.now() + this.ttlMs,
      ttlMs: toPositiveInt(ttlMs, this.ttlMs),
      maxQueue: toPositiveInt(maxQueue, this.maxQueue),
      waiters: [],
      client: this.clientFactory({ channel, sessionId: id }),
    };

    if (!session.client || typeof session.client.connect !== "function") {
      throw new ValidationError("ws client factory must return an object with connect()");
    }

    this.sessions.set(id, session);
    this.latestSessionId = id;
    this.latestByChannel.set(channel, id);
    this.bindClientEvents(session);

    try {
      await this.connectClientWithTimeout(session, channel, subscription);
      session.connected = true;
      this.touch(session);
    } catch (error) {
      try {
        await session.client?.disconnect?.();
      } catch {
        // ignore disconnect failure on failed subscribe
      }
      this.sessions.delete(id);
      if (this.latestSessionId === id) this.latestSessionId = null;
      if (this.latestByChannel.get(channel) === id) this.latestByChannel.delete(channel);
      throw error;
    }

    return {
      sessionId: id,
      channel,
      subscription,
      stats: this.sessionStats(session),
    };
  }

  async connectClientWithTimeout(session, channel, subscription) {
    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new ValidationError(`WebSocket subscribe timeout after ${this.connectTimeoutMs}ms`));
      }, this.connectTimeoutMs);
      timer.unref?.();
    });

    try {
      await Promise.race([session.client.connect(channel, subscription), timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async waitForEvent(session, waitMs) {
    if (session.queue.length > 0) return;
    const safeWaitMs = toNonNegativeInt(waitMs, 0);
    if (safeWaitMs <= 0) return;

    await new Promise((resolve) => {
      const waiter = {
        resolve: () => {
          if (waiter.timer) clearTimeout(waiter.timer);
          resolve();
        },
        timer: null,
      };

      waiter.timer = setTimeout(() => {
        session.waiters = session.waiters.filter((item) => item !== waiter);
        resolve();
      }, safeWaitMs);
      waiter.timer.unref?.();

      session.waiters.push(waiter);
    });
  }

  async poll({ sessionId, channel = undefined, maxEvents = 100, waitMs = 0 } = {}) {
    await this.cleanupExpired();
    const resolvedSessionId = this.resolveSessionId(sessionId, channel);
    if (!resolvedSessionId) {
      throw new ValidationError("sessionId is required (or use sessionId='auto' after subscribe)");
    }

    const session = this.sessions.get(resolvedSessionId);
    if (!session) {
      throw new ValidationError(`WS session not found: ${resolvedSessionId}`);
    }

    await this.waitForEvent(session, waitMs);

    const safeMaxEvents = Math.min(toPositiveInt(maxEvents, 100), session.maxQueue);
    const events = session.queue.splice(0, safeMaxEvents);
    session.lastPollAt = this.now();
    this.touch(session);

    return {
      sessionId: session.id,
      channel: session.channel,
      events,
      stats: this.sessionStats(session),
    };
  }

  async closeSession(session, reason = "user") {
    if (!session) return;

    this.sessions.delete(session.id);
    if (this.latestSessionId === session.id) {
      const latest = this.sessions.keys().next().value;
      this.latestSessionId = latest ?? null;
    }
    if (this.latestByChannel.get(session.channel) === session.id) {
      this.latestByChannel.delete(session.channel);
    }

    this.wakeWaiters(session);
    try {
      await session.client?.disconnect?.();
    } catch {
      // ignore disconnect failures during cleanup
    }

    session.connected = false;
    session.closedAt = this.now();
    session.closeReason = reason;
  }

  async unsubscribe({ sessionId, channel = undefined } = {}) {
    await this.cleanupExpired();
    const resolvedSessionId = this.resolveSessionId(sessionId, channel);
    if (!resolvedSessionId) {
      throw new ValidationError("sessionId is required (or use sessionId='auto' after subscribe)");
    }

    const session = this.sessions.get(resolvedSessionId);
    if (!session) {
      throw new ValidationError(`WS session not found: ${resolvedSessionId}`);
    }

    await this.closeSession(session, "user");
    return {
      sessionId: resolvedSessionId,
      closed: true,
    };
  }

  async cleanupExpired() {
    const now = this.now();
    const expired = [];
    for (const session of this.sessions.values()) {
      if (session.expiresAt <= now) {
        expired.push(session);
      }
    }
    for (const session of expired) {
      await this.closeSession(session, "ttl_expired");
    }
    return expired.length;
  }

  async closeAll() {
    const sessions = [...this.sessions.values()];
    for (const session of sessions) {
      await this.closeSession(session, "shutdown");
    }
  }
}
