import test from "node:test";
import assert from "node:assert/strict";
import { PositionService } from "../src/openclaw/polymarket/services/positionService.mjs";

function buildService({ clobOpenOrdersFails = false } = {}) {
  const clob = {
    async getOpenOrders() {
      if (clobOpenOrdersFails) throw new Error("open orders timeout");
      return [{ id: "o1" }];
    },
    async getTrades() {
      return [{ id: "t1" }];
    },
    async getNotifications() {
      return [{ id: "n1" }];
    },
  };

  const dataApi = {
    async getPositions() {
      return [{ id: "p1" }];
    },
    async getActivity() {
      return [{ id: "a1" }];
    },
    async getValue() {
      return { total: "1.23" };
    },
  };

  return new PositionService({ clobService: clob, dataApiClient: dataApi });
}

test("syncAccountState defaults to data-api only and succeeds", async () => {
  const service = buildService({ clobOpenOrdersFails: true });
  const res = await service.syncAccountState({ address: "0xabc" });

  assert.equal(res.degraded, false);
  assert.equal(res.sourceStatus.openOrders, "skipped");
  assert.deepEqual(res.positions, [{ id: "p1" }]);
});

test("syncAccountState degrades when optional CLOB source fails", async () => {
  const service = buildService({ clobOpenOrdersFails: true });
  const res = await service.syncAccountState({
    address: "0xabc",
    includeOpenOrders: true,
  });

  assert.equal(res.degraded, true);
  assert.equal(res.sourceStatus.openOrders, "error");
  assert.equal(res.syncIssues.length, 1);
  assert.match(res.syncIssues[0].message, /open orders timeout/);
  assert.deepEqual(res.positions, [{ id: "p1" }]);
});
