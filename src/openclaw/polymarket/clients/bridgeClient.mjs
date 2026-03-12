import { HttpClient } from "../http/httpClient.mjs";
import { ValidationError } from "../errors.mjs";

export class BridgeClient {
  constructor({ config }) {
    this.config = config;
    this.http = new HttpClient({
      rateLimit: config.rateLimits.bridge,
      retry: config.retry,
      adapter: "fetch",
      fallbackToCurl: true,
      timeoutMs: config.requestTimeoutMs,
      proxyUrl: config.proxyUrl,
    });
  }

  url(path) {
    return `${this.config.bridgeHost}${path}`;
  }

  async getSupportedAssets(params = {}) {
    const res = await this.http.get(this.url(this.config.endpoints.bridge.supportedAssets), params);
    return res.data;
  }

  async getQuote(payload) {
    const res = await this.http.post(this.url(this.config.endpoints.bridge.quote), payload);
    return res.data;
  }

  async createDeposit(payload) {
    const res = await this.http.post(this.url(this.config.endpoints.bridge.deposit), payload);
    return res.data;
  }

  async createWithdraw(payload) {
    const res = await this.http.post(this.url(this.config.endpoints.bridge.withdraw), payload);
    return res.data;
  }

  async getStatus(address, params = {}) {
    if (!address) throw new ValidationError("address is required for bridge status");
    const path = `${this.config.endpoints.bridge.status}/${address}`;
    const res = await this.http.get(this.url(path), params);
    return res.data;
  }
}
