import test from "node:test";
import assert from "node:assert/strict";
import { CredentialManager } from "../src/openclaw/polymarket/auth/credentialManager.mjs";

function mockClob({ creds = null, valid = false } = {}) {
  let currentCreds = creds;
  let created = 0;

  return {
    getApiCreds() {
      return currentCreds;
    },
    setApiCreds(next) {
      currentCreds = next;
      return next;
    },
    async getApiKeys() {
      if (!valid && created === 0) {
        throw new Error("invalid key");
      }
      return { apiKeys: [{ key: "k1" }] };
    },
    async createOrDeriveApiKey() {
      created += 1;
      return {
        key: "new-key",
        secret: "new-secret",
        passphrase: "new-passphrase",
      };
    },
    async createApiKey() {
      return this.createOrDeriveApiKey();
    },
    async deriveApiKey() {
      return this.createOrDeriveApiKey();
    },
  };
}

test("CredentialManager validateOrRecover keeps valid creds", async () => {
  const clob = mockClob({
    creds: { key: "k", secret: "s", passphrase: "p" },
    valid: true,
  });

  const manager = new CredentialManager({ clobService: clob });
  const res = await manager.validateOrRecover();

  assert.equal(res.key, "k");
});

test("CredentialManager validateOrRecover recovers invalid creds", async () => {
  const clob = mockClob({
    creds: { key: "bad", secret: "bad", passphrase: "bad" },
    valid: false,
  });

  const manager = new CredentialManager({ clobService: clob });
  const res = await manager.validateOrRecover();

  assert.equal(res.key, "new-key");
  assert.equal(res.secret, "new-secret");
  assert.equal(res.passphrase, "new-passphrase");
});
