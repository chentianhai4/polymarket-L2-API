import { injectBuilderHeaders } from "@polymarket/clob-client";

export class BuilderClient {
  constructor({ clobService, builderAddress = undefined, builderName = undefined }) {
    this.clob = clobService;
    this.builderAddress = builderAddress;
    this.builderName = builderName;
  }

  async createBuilderApiKey() {
    return await this.clob.createBuilderApiKey();
  }

  async getBuilderApiKeys() {
    return await this.clob.getBuilderApiKeys();
  }

  async revokeBuilderApiKey() {
    return await this.clob.revokeBuilderApiKey();
  }

  async getBuilderTrades(params, nextCursor = undefined) {
    return await this.clob.getBuilderTrades(params, nextCursor);
  }

  buildAttributionHeaders(extra = {}) {
    const headers = {
      ...(this.builderAddress ? { POLY_BUILDER: this.builderAddress } : {}),
      ...(this.builderName ? { POLY_BUILDER_NAME: this.builderName } : {}),
      ...extra,
    };
    return injectBuilderHeaders({}, headers);
  }
}
