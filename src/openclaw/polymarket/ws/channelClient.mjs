import EventEmitter from "node:events";
import WebSocket from "ws";
import { normalizeRealtimeEvent } from "./eventNormalizer.mjs";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class WsChannelClient extends EventEmitter {
  constructor({ config, clobService, metrics }) {
    super();
    this.config = config;
    this.clob = clobService;
    this.metrics = metrics;
    this.socket = null;
    this.connected = false;
    this.stopped = false;
    this.heartbeatTimer = null;
    this.lastPong = 0;
    this.channel = null;
    this.subscription = null;
  }

  async connect(channel, subscription = {}) {
    this.channel = channel;
    this.subscription = subscription;
    this.stopped = false;

    let attempt = 0;
    let delay = this.config.ws.reconnectInitialDelayMs;

    while (!this.stopped) {
      try {
        await this.openSocket();
        await this.subscribe(channel, subscription);
        this.connected = true;
        this.emit("connected", { channel });
        this.metrics.setGauge("ws_connected", 1, { channel });
        return;
      } catch (error) {
        this.connected = false;
        this.metrics.inc("ws_reconnect_attempt_total", 1, { channel });
        this.emit("reconnect", { channel, attempt, error: error?.message ?? String(error) });

        attempt += 1;
        await sleep(delay);
        delay = Math.min(this.config.ws.reconnectMaxDelayMs, delay * 2);
      }
    }
  }

  async disconnect() {
    this.stopped = true;
    this.connected = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.metrics.setGauge("ws_connected", 0, { channel: this.channel ?? "unknown" });

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.close();
      this.socket = null;
    }
  }

  async openSocket() {
    const base = this.config.wsHost.endsWith("/") ? this.config.wsHost.slice(0, -1) : this.config.wsHost;
    const url = `${base}/${this.channel}`;

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timeout = setTimeout(() => {
        ws.terminate();
        reject(new Error(`WebSocket connect timeout: ${url}`));
      }, 15000);

      ws.once("open", () => {
        clearTimeout(timeout);
        this.socket = ws;
        this.wireSocket(ws);
        resolve();
      });

      ws.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  wireSocket(ws) {
    ws.on("message", (msg) => {
      try {
        const raw = JSON.parse(msg.toString());
        const normalized = normalizeRealtimeEvent(raw);
        this.metrics.inc("ws_message_total", 1, { channel: this.channel, type: normalized.type });
        this.emit("event", normalized);
      } catch (error) {
        this.metrics.inc("ws_parse_error_total", 1, { channel: this.channel });
        this.emit("error", error);
      }
    });

    ws.on("pong", () => {
      this.lastPong = Date.now();
    });

    ws.on("close", () => {
      this.connected = false;
      this.metrics.setGauge("ws_connected", 0, { channel: this.channel });
      this.emit("disconnected", { channel: this.channel });
      if (!this.stopped) this.connect(this.channel, this.subscription).catch((err) => this.emit("error", err));
    });

    ws.on("error", (error) => this.emit("error", error));

    this.startHeartbeat();
  }

  async subscribe(channel, subscription) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    const payload = {
      type: channel,
      ...(subscription ?? {}),
    };

    if (channel === "user") {
      payload.auth = await this.buildUserAuthPayload();
    }

    this.socket.send(JSON.stringify(payload));
    this.metrics.inc("ws_subscribe_total", 1, { channel });
  }

  async buildUserAuthPayload() {
    const headers = await this.clob.createL2Headers("/ws/user", "GET");
    return {
      address: headers.POLY_ADDRESS,
      signature: headers.POLY_SIGNATURE,
      timestamp: headers.POLY_TIMESTAMP,
      apiKey: headers.POLY_API_KEY,
      passphrase: headers.POLY_PASSPHRASE,
      api_key: headers.POLY_API_KEY,
    };
  }

  startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.lastPong = Date.now();

    this.heartbeatTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      this.socket.ping();

      const elapsed = Date.now() - this.lastPong;
      if (elapsed > this.config.ws.pongTimeoutMs) {
        this.metrics.inc("ws_pong_timeout_total", 1, { channel: this.channel });
        this.socket.terminate();
      }
    }, this.config.ws.heartbeatIntervalMs);
  }
}
