import { HttpClient } from "../http/httpClient.mjs";

export class DataApiClient {
  constructor({ config }) {
    this.config = config;
    this.http = new HttpClient({
      rateLimit: config.rateLimits.dataApi,
      retry: config.retry,
      adapter: "fetch",
      fallbackToCurl: true,
      timeoutMs: config.requestTimeoutMs,
      proxyUrl: config.proxyUrl,
    });
  }

  url(path) {
    return `${this.config.dataApiHost}${path}`;
  }

  async getTrades(params = {}) {
    const res = await this.http.get(this.url(this.config.endpoints.dataApi.trades), params);
    return res.data;
  }

  async getPositions(params = {}) {
    const res = await this.http.get(this.url(this.config.endpoints.dataApi.positions), params);
    return res.data;
  }

  async getActivity(params = {}) {
    const res = await this.http.get(this.url(this.config.endpoints.dataApi.activity), params);
    return res.data;
  }

  async getValue(params = {}) {
    const res = await this.http.get(this.url(this.config.endpoints.dataApi.value), params);
    return res.data;
  }

  async getHolders(params = {}) {
    const res = await this.http.get(this.url(this.config.endpoints.dataApi.holders), params);
    return res.data;
  }

  async getClosedPositions(params = {}) {
    const res = await this.http.get(this.url(this.config.endpoints.dataApi.closedPositions), params);
    return res.data;
  }

  async getTraded(params = {}) {
    const res = await this.http.get(this.url(this.config.endpoints.dataApi.traded), params);
    return res.data;
  }

  async getLeaderboard(params = {}) {
    const res = await this.http.get(this.url(this.config.endpoints.dataApi.leaderboard), params);
    return res.data;
  }

  async getBuildersLeaderboard(params = {}) {
    const res = await this.http.get(this.url(this.config.endpoints.dataApi.buildersLeaderboard), params);
    return res.data;
  }

  async getBuildersVolume(params = {}) {
    const res = await this.http.get(this.url(this.config.endpoints.dataApi.buildersVolume), params);
    return res.data;
  }

  async getAccountingSnapshot(params = {}) {
    const res = await this.http.get(this.url(this.config.endpoints.dataApi.accountingSnapshot), params);
    return res.data;
  }
}
