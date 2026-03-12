import { hasApiCreds, normalizeApiCreds } from "../types.mjs";
import { AuthError } from "../errors.mjs";

export class CredentialManager {
  constructor({ clobService }) {
    this.clob = clobService;
  }

  async createApiKey(nonce = undefined) {
    const creds = normalizeApiCreds(await this.clob.createApiKey(nonce));
    if (!hasApiCreds(creds)) throw new AuthError("createApiKey returned invalid creds", { creds });
    this.clob.setApiCreds(creds);
    return creds;
  }

  async deriveApiKey(nonce = undefined) {
    const creds = normalizeApiCreds(await this.clob.deriveApiKey(nonce));
    if (!hasApiCreds(creds)) throw new AuthError("deriveApiKey returned invalid creds", { creds });
    this.clob.setApiCreds(creds);
    return creds;
  }

  async createOrDeriveApiKey(nonce = undefined) {
    const creds = normalizeApiCreds(await this.clob.createOrDeriveApiKey(nonce));
    if (!hasApiCreds(creds)) throw new AuthError("createOrDeriveApiKey returned invalid creds", { creds });
    this.clob.setApiCreds(creds);
    return creds;
  }

  async getApiKeys() {
    return await this.clob.getApiKeys();
  }

  async deleteApiKey() {
    return await this.clob.deleteApiKey();
  }

  async rotateApiKey() {
    try {
      await this.deleteApiKey();
    } catch {
      // rotate should still continue to recover if delete fails.
    }
    return await this.createOrDeriveApiKey();
  }

  async validateOrRecover() {
    const existing = this.clob.getApiCreds();
    if (hasApiCreds(existing)) {
      const ok = await this.validateCurrentCreds();
      if (ok) return normalizeApiCreds(existing);
    }
    return await this.createOrDeriveApiKey();
  }

  async validateCurrentCreds() {
    try {
      const res = await this.clob.getApiKeys();
      return Boolean(res && Array.isArray(res.apiKeys));
    } catch (error) {
      return false;
    }
  }
}
