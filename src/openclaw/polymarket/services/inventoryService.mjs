import { ValidationError } from "../errors.mjs";

export class InventoryService {
  constructor({ relayerClient, directExecutor = undefined }) {
    this.relayer = relayerClient;
    this.directExecutor = directExecutor;
  }

  async split({ mode = "relayer", payload }) {
    this.assertPayload(payload, "split");
    if (mode === "direct") return await this.runDirect("split", payload);
    return await this.relayer.split(payload);
  }

  async merge({ mode = "relayer", payload }) {
    this.assertPayload(payload, "merge");
    if (mode === "direct") return await this.runDirect("merge", payload);
    return await this.relayer.merge(payload);
  }

  async redeem({ mode = "relayer", payload }) {
    this.assertPayload(payload, "redeem");
    if (mode === "direct") return await this.runDirect("redeem", payload);
    return await this.relayer.redeem(payload);
  }

  async approve({ mode = "relayer", payload }) {
    this.assertPayload(payload, "approve");
    if (mode === "direct") return await this.runDirect("approve", payload);
    return await this.relayer.approve(payload);
  }

  async runDirect(action, payload) {
    if (typeof this.directExecutor !== "function") {
      throw new ValidationError(`Direct ${action} requested but no directExecutor configured`);
    }
    return await this.directExecutor(action, payload);
  }

  assertPayload(payload, action) {
    if (!payload || typeof payload !== "object") {
      throw new ValidationError(`${action} payload must be an object`);
    }
  }
}
