import { HttpClient } from "../http/httpClient.mjs";

export class RelayerClient {
  constructor({ config, authToken = undefined }) {
    this.config = config;
    this.authToken = authToken;
    this.http = new HttpClient({
      rateLimit: config.rateLimits.relayer,
      retry: config.retry,
      adapter: "fetch",
      fallbackToCurl: true,
      timeoutMs: config.requestTimeoutMs,
      proxyUrl: config.proxyUrl,
    });
  }

  headers(extra = {}) {
    const out = { ...extra };
    if (this.authToken) out.Authorization = `Bearer ${this.authToken}`;
    return out;
  }

  url(path) {
    return `${this.config.relayerHost}${path}`;
  }

  async deployWallet(payload) {
    const res = await this.http.post(this.url(this.config.endpoints.relayer.deployWallet), payload, this.headers());
    return res.data;
  }

  async approve(payload) {
    const res = await this.http.post(this.url(this.config.endpoints.relayer.approve), payload, this.headers());
    return res.data;
  }

  async split(payload) {
    const res = await this.http.post(this.url(this.config.endpoints.relayer.split), payload, this.headers());
    return res.data;
  }

  async merge(payload) {
    const res = await this.http.post(this.url(this.config.endpoints.relayer.merge), payload, this.headers());
    return res.data;
  }

  async redeem(payload) {
    const res = await this.http.post(this.url(this.config.endpoints.relayer.redeem), payload, this.headers());
    return res.data;
  }

  async batch(payload) {
    const res = await this.http.post(this.url(this.config.endpoints.relayer.batch), payload, this.headers());
    return res.data;
  }

  async getTxStatus(txId) {
    const path = `${this.config.endpoints.relayer.txStatus}/${txId}`;
    const res = await this.http.get(this.url(path), undefined, this.headers());
    return res.data;
  }
}
