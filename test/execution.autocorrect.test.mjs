import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionEngine } from "../src/openclaw/polymarket/execution/executionEngine.mjs";
import { RiskBlockedError } from "../src/openclaw/polymarket/errors.mjs";

function createSignal({
  tokenId = "123",
  conditionId = "0xabc",
  side = "BUY",
  intentType = "LIMIT",
} = {}) {
  return {
    skillId: "skill-autocorrect",
    intentType,
    marketSelector: { tokenId, conditionId },
    side,
    sizePolicy: { mode: "fixed", value: 1 },
    pricePolicy: { mode: "limit", value: 0.7 },
    riskPolicy: {},
    timeInForce: "GTC",
  };
}

function createEngine({
  intent,
  clobOverrides = {},
  riskOverrides = {},
  quote = null,
} = {}) {
  const calls = {
    createOrder: 0,
    createMarketOrder: 0,
    postOrder: 0,
    deriveOrderId: 0,
    getOrder: 0,
    riskEvaluate: 0,
    riskInput: null,
    createOrderArgs: null,
    createMarketOrderArgs: null,
    postOrderArgs: null,
  };

  const clob = {
    funderAddress: "0xfunder000000000000000000000000000000000001",
    async getSignerAddress() {
      return "0xsigner000000000000000000000000000000000001";
    },
    async getOrderBook() {
      return {
        bids: [{ price: "0.62", size: "100" }],
        asks: [{ price: "0.63", size: "100" }],
        min_order_size: "5",
        tick_size: "0.01",
      };
    },
    async getTickSize() {
      return "0.01";
    },
    async getFeeRateBps() {
      return 12;
    },
    async getNegRisk() {
      return true;
    },
    toUserOrder(orderIntent) {
      return orderIntent;
    },
    toUserMarketOrder(orderIntent) {
      return orderIntent;
    },
    extractOrderIds(payload) {
      if (Array.isArray(payload?.orderIDs)) return payload.orderIDs.map(String);
      if (payload?.orderID) return [String(payload.orderID)];
      if (payload?.orderId) return [String(payload.orderId)];
      if (payload?.id) return [String(payload.id)];
      return [];
    },
    isInvalidOrderSubmissionPayload(payload) {
      if (payload?.__openclawInvalidSubmission === true) return true;
      if (payload === undefined || payload === null) return true;
      if (typeof payload === "string") return payload.trim() === "";
      if (Array.isArray(payload)) return payload.length === 0;
      if (typeof payload !== "object") return true;
      return Object.keys(payload).length === 0;
    },
    async getOpenOrders() {
      return [];
    },
    async getTrades() {
      return [];
    },
    async getNotifications() {
      return [];
    },
    async createOrder(order, options) {
      calls.createOrder += 1;
      calls.createOrderArgs = { order, options };
      return { ...order, __signed: true };
    },
    async createMarketOrder(order, options) {
      calls.createMarketOrder += 1;
      calls.createMarketOrderArgs = { order, options };
      return { ...order, __signed: true };
    },
    deriveOrderId() {
      calls.deriveOrderId += 1;
      return null;
    },
    async getOrder() {
      calls.getOrder += 1;
      throw new Error("not found");
    },
    async postOrder(order, orderType, deferExec, postOnly) {
      calls.postOrder += 1;
      calls.postOrderArgs = { order, orderType, deferExec, postOnly };
      return { status: "LIVE", orderID: "oid-1" };
    },
    ...clobOverrides,
  };

  const risk = {
    async evaluate(nextIntent) {
      calls.riskEvaluate += 1;
      calls.riskInput = nextIntent;
      return {
        decision: "ALLOW",
        effectiveAction: "CONTINUE",
        reasonCodes: [],
        requiredActions: [],
        diagnostics: {},
      };
    },
    recordFilledIntent() {},
    ...riskOverrides,
  };

  const engine = new ExecutionEngine({
    config: {
      requestTimeoutMs: 30000,
      retry: { retries: 1 },
      submissionConfirm: {
        maxAttempts: 2,
        intervalMs: 5,
      },
    },
    compiler: {
      compile() {
        return { ...intent };
      },
    },
    riskEngine: risk,
    quoteService: {
      async getQuote() {
        return quote;
      },
    },
    clobService: clob,
    metrics: {
      inc() {},
      observe() {},
    },
    auditLogger: {
      write() {},
    },
  });

  return { engine, calls };
}

test("ExecutionEngine respects BUY LIMIT user price and only adjusts size/tick constraints", async () => {
  const signal = createSignal({ side: "BUY", intentType: "LIMIT" });
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "LIMIT",
    size: 1,
    limitPrice: 0.72,
    timeInForce: "GTC",
    postOnly: false,
  };
  const { engine, calls } = createEngine({ intent });

  const result = await engine.executeSkillSignal(signal, { countryCode: "SG" });

  assert.equal(calls.riskEvaluate, 1);
  assert.equal(calls.riskInput.size, 5);
  assert.equal(calls.riskInput.limitPrice, 0.72);
  assert.equal(calls.createOrder, 1);
  assert.equal(calls.createMarketOrder, 0);
  assert.equal(calls.postOrder, 1);
  assert.equal(calls.createOrderArgs.order.size, 5);
  assert.equal(calls.createOrderArgs.order.limitPrice, 0.72);
  assert.deepEqual(calls.createOrderArgs.options, {
    tickSize: "0.01",
    negRisk: true,
  });
  assert.equal(result.accepted, true);
  assert.ok(result.warnings.includes("AUTO_ADJUST_SIZE_TO_MIN_ORDER_SIZE:5"));
  assert.equal(result.rawExchangePayload.adjustments.blocked, false);
  assert.equal(result.rawExchangePayload.adjustments.changes.length, 1);
});

test("normalizeIntentForMarket blocks postOnly orders that would cross the opposite book edge", async () => {
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "LIMIT",
    size: 10,
    limitPrice: 0.63,
    postOnly: true,
    timeInForce: "GTC",
  };
  const { engine } = createEngine({ intent });

  const normalized = await engine.normalizeIntentForMarket(intent, "BUY", {
    retries: 1,
  });

  assert.equal(normalized.blocked, true);
  assert.equal(normalized.error.code, "POST_ONLY_WOULD_TAKE_LIQUIDITY");
  assert.ok(normalized.warnings.includes("POST_ONLY_WOULD_TAKE_LIQUIDITY"));
});

test("ExecutionEngine executes MARKET via createMarketOrder+postOrder with mapped FAK and synthetic marketable price", async () => {
  const signal = createSignal({ side: "BUY", intentType: "MARKET" });
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "MARKET",
    amount: 8,
    timeInForce: "GTC",
  };
  const { engine, calls } = createEngine({ intent });

  const result = await engine.executeSkillSignal(signal, { countryCode: "SG" });

  assert.equal(result.accepted, true);
  assert.equal(calls.createOrder, 0);
  assert.equal(calls.createMarketOrder, 1);
  assert.equal(calls.postOrder, 1);
  assert.equal(calls.postOrderArgs.orderType, "FAK");
  assert.equal(calls.postOrderArgs.postOnly, false);
  assert.equal(calls.createMarketOrderArgs.order.limitPrice, 0.66);
  assert.ok(result.warnings.includes("MARKET_TIME_IN_FORCE_MAPPED_TO_FAK"));
});

test("normalizeIntentForMarket keeps SELL limit price from becoming more aggressive", async () => {
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "SELL",
    orderType: "LIMIT",
    size: 10,
    limitPrice: 0.8,
    timeInForce: "GTC",
  };
  const { engine } = createEngine({ intent });

  const normalized = await engine.normalizeIntentForMarket(intent, "SELL", {
    retries: 1,
    priceOffsetTicks: 3,
  });

  assert.equal(normalized.blocked, false);
  assert.equal(normalized.intent.limitPrice, 0.8);
  assert.equal(
    normalized.adjustments.changes.some((item) => item.field === "limitPrice"),
    false,
  );
});

test("normalizeIntentForMarket blocks with MARKET_METADATA_UNAVAILABLE after retries", async () => {
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "LIMIT",
    size: 1,
    limitPrice: 0.5,
    timeInForce: "GTC",
  };
  const { engine } = createEngine({
    intent,
    clobOverrides: {
      async getOrderBook() {
        throw new Error("upstream timeout");
      },
      async getTickSize() {
        throw new Error("upstream timeout");
      },
    },
  });

  const normalized = await engine.normalizeIntentForMarket(intent, "BUY", {
    retries: 1,
    retryDelayMs: 10,
  });

  assert.equal(normalized.blocked, true);
  assert.equal(normalized.error.code, "MARKET_METADATA_UNAVAILABLE");
  assert.equal(Array.isArray(normalized.adjustments.retries), true);
  assert.equal(normalized.adjustments.retries.length, 2);
  assert.ok(normalized.warnings.includes("MARKET_METADATA_UNAVAILABLE"));
});

test("ExecutionEngine returns BLOCKED result when metadata unavailable and skips risk/order paths", async () => {
  const signal = createSignal({ side: "BUY", intentType: "LIMIT" });
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "LIMIT",
    size: 1,
    limitPrice: 0.5,
    timeInForce: "GTC",
  };
  const { engine, calls } = createEngine({
    intent,
    clobOverrides: {
      async getOrderBook() {
        throw new Error("metadata timeout");
      },
      async getTickSize() {
        throw new Error("metadata timeout");
      },
    },
  });

  const result = await engine.executeSkillSignal(signal, { countryCode: "SG" });

  assert.equal(result.accepted, false);
  assert.equal(result.finalStatus, "BLOCKED");
  assert.equal(result.errorCode, "MARKET_METADATA_UNAVAILABLE");
  assert.ok(result.warnings.includes("MARKET_METADATA_UNAVAILABLE"));
  assert.equal(calls.riskEvaluate, 0);
  assert.equal(calls.createOrder, 0);
  assert.equal(calls.createMarketOrder, 0);
  assert.equal(calls.postOrder, 0);
});

test("LIMIT+FAK empty submission with no evidence returns FAK_NOT_FILLED instead of throwing", async () => {
  const signal = createSignal({ side: "BUY", intentType: "LIMIT" });
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "LIMIT",
    size: 5,
    limitPrice: 0.59,
    timeInForce: "FAK",
  };

  const { engine } = createEngine({
    intent,
    clobOverrides: {
      async postOrder() {
        return "";
      },
      async getOpenOrders() {
        return [];
      },
      async getTrades() {
        return [];
      },
    },
  });

  const result = await engine.executeSkillSignal(signal, { countryCode: "SG" });
  assert.equal(result.accepted, true);
  assert.equal(result.finalStatus, "FAK_NOT_FILLED");
  assert.deepEqual(result.orderIds, []);
  assert.ok(
    result.warnings.includes("FAK_NO_FILL_EVIDENCE_AFTER_CONFIRMATION"),
  );
  assert.equal(
    result.rawExchangePayload?.submissionDiagnostics?.matchResult?.mode,
    "NO_MATCH",
  );
});

test("LIMIT+FAK timeout submission with no evidence returns FAK_TIMEOUT_NO_EVIDENCE instead of throwing", async () => {
  const signal = createSignal({ side: "BUY", intentType: "LIMIT" });
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "LIMIT",
    size: 5,
    limitPrice: 0.59,
    timeInForce: "FAK",
  };

  const { engine } = createEngine({
    intent,
    clobOverrides: {
      async postOrder() {
        const error = new Error("Request timeout after 15000ms (postOrder)");
        error.status = 0;
        error.details = { operation: "postOrder" };
        throw error;
      },
      async getOpenOrders() {
        return [];
      },
      async getTrades() {
        return [];
      },
    },
  });

  const result = await engine.executeSkillSignal(signal, { countryCode: "SG" });
  assert.equal(result.accepted, true);
  assert.equal(result.finalStatus, "FAK_TIMEOUT_NO_EVIDENCE");
  assert.deepEqual(result.orderIds, []);
  assert.ok(result.warnings.includes("ORDER_SUBMISSION_TIMEOUT_SYNC_CONFIRM"));
  assert.ok(
    result.warnings.includes("FAK_NO_FILL_EVIDENCE_AFTER_CONFIRMATION"),
  );
  assert.ok(result.warnings.includes("FAK_SUBMISSION_TIMEOUT_ASSUMED_NO_FILL"));
});

test("LIMIT+FAK with trade evidence still confirms via sync lookup", async () => {
  const signal = createSignal({ side: "BUY", intentType: "LIMIT" });
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "LIMIT",
    size: 5,
    limitPrice: 0.59,
    timeInForce: "FAK",
  };

  const { engine } = createEngine({
    intent,
    clobOverrides: {
      async postOrder() {
        return "";
      },
      async getOpenOrders() {
        return [];
      },
      async getTrades() {
        return [
          {
            id: "trade-fak-1",
            taker_order_id: "oid-fak-confirmed-1",
            asset_id: "123",
            side: "BUY",
            price: "0.59",
            size: "5",
          },
        ];
      },
    },
  });

  const result = await engine.executeSkillSignal(signal, { countryCode: "SG" });
  assert.equal(result.accepted, true);
  assert.equal(result.finalStatus, "CONFIRMED_BY_SYNC");
  assert.deepEqual(result.orderIds, ["oid-fak-confirmed-1"]);
  assert.ok(result.warnings.includes("ORDER_CONFIRMED_BY_TRADE_ORDER_ID"));
});

test("placeIntent rejects with ORDER_SUBMISSION_UNCONFIRMED when submission payload is empty and sync lookup cannot confirm", async () => {
  const signal = createSignal({ side: "BUY", intentType: "LIMIT" });
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "LIMIT",
    size: 5,
    limitPrice: 0.59,
    timeInForce: "GTC",
  };

  const { engine } = createEngine({
    intent,
    clobOverrides: {
      async postOrder() {
        return "";
      },
      async getOpenOrders() {
        return [];
      },
      async getTrades() {
        return [];
      },
    },
  });

  await assert.rejects(
    async () => {
      await engine.executeSkillSignal(signal, { countryCode: "SG" });
    },
    (error) => {
      assert.equal(error instanceof RiskBlockedError, true);
      assert.equal(error.details?.errorCode, "ORDER_SUBMISSION_UNCONFIRMED");
      assert.equal(
        Array.isArray(error.details?.submissionDiagnostics?.confirmAttempts),
        true,
      );
      return true;
    },
  );
});

test("placeIntent confirms empty submission via sync_orders unique match and backfills order id", async () => {
  const signal = createSignal({ side: "BUY", intentType: "LIMIT" });
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "LIMIT",
    size: 5,
    limitPrice: 0.59,
    timeInForce: "GTC",
  };

  const { engine } = createEngine({
    intent,
    clobOverrides: {
      async postOrder() {
        return "";
      },
      async getOpenOrders() {
        this.__openOrderCalls = (this.__openOrderCalls ?? 0) + 1;
        if (this.__openOrderCalls <= 2) {
          return [];
        }
        return [
          {
            id: "oid-confirmed-1",
            asset_id: "123",
            side: "BUY",
            price: "0.59",
            original_size: "5",
          },
        ];
      },
      async getTrades() {
        return [];
      },
    },
  });

  const result = await engine.executeSkillSignal(signal, { countryCode: "SG" });
  assert.equal(result.accepted, true);
  assert.deepEqual(result.orderIds, ["oid-confirmed-1"]);
  assert.equal(result.finalStatus, "CONFIRMED_BY_SYNC");
  assert.ok(result.warnings.includes("ORDER_CONFIRMED_BY_SYNC_LOOKUP"));
});

test("placeIntent treats submission timeout as unknown submission and confirms via sync lookup", async () => {
  const signal = createSignal({ side: "BUY", intentType: "LIMIT" });
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "LIMIT",
    size: 5,
    limitPrice: 0.59,
    timeInForce: "GTC",
  };

  const { engine } = createEngine({
    intent,
    clobOverrides: {
      async postOrder() {
        const error = new Error("Request timeout after 15000ms (postOrder)");
        error.status = 0;
        error.details = { operation: "postOrder" };
        throw error;
      },
      async getOpenOrders() {
        this.__openOrderCalls = (this.__openOrderCalls ?? 0) + 1;
        if (this.__openOrderCalls <= 3) return [];
        return [
          {
            id: "oid-timeout-confirmed-1",
            asset_id: "123",
            side: "BUY",
            price: "0.59",
            original_size: "5",
          },
        ];
      },
      async getTrades() {
        return [];
      },
    },
  });

  const result = await engine.executeSkillSignal(signal, { countryCode: "SG" });
  assert.equal(result.accepted, true);
  assert.equal(result.finalStatus, "CONFIRMED_BY_SYNC");
  assert.deepEqual(result.orderIds, ["oid-timeout-confirmed-1"]);
  assert.ok(result.warnings.includes("ORDER_SUBMISSION_TIMEOUT_SYNC_CONFIRM"));
  assert.ok(
    result.warnings.includes("ORDER_CONFIRMED_AFTER_SUBMISSION_TIMEOUT"),
  );
});

test("placeIntent confirms empty submission via localDerivedOrderId + direct getOrder lookup and skips invalid market filter", async () => {
  const signal = createSignal({
    side: "BUY",
    intentType: "LIMIT",
    conditionId: "553825",
  });
  const intent = {
    tokenId: "123",
    conditionId: "553825",
    side: "BUY",
    orderType: "LIMIT",
    size: 5,
    limitPrice: 0.59,
    timeInForce: "GTC",
  };

  const { engine } = createEngine({
    intent,
    clobOverrides: {
      deriveOrderId() {
        return "oid-local-derived-1";
      },
      async postOrder() {
        return "";
      },
      async getOpenOrders(params) {
        assert.equal("market" in params, false);
        return [];
      },
      async getTrades(params) {
        assert.equal("market" in params, false);
        return [];
      },
      async getOrder(orderId) {
        assert.equal(orderId, "oid-local-derived-1");
        return {
          id: "oid-local-derived-1",
          asset_id: "123",
          side: "BUY",
          price: "0.59",
          original_size: "5",
        };
      },
    },
  });

  const result = await engine.executeSkillSignal(signal, { countryCode: "SG" });
  assert.equal(result.accepted, true);
  assert.deepEqual(result.orderIds, ["oid-local-derived-1"]);
  assert.equal(result.finalStatus, "CONFIRMED_BY_SYNC");
  assert.ok(result.warnings.includes("INVALID_CONDITION_ID_FILTER_SKIPPED"));
  assert.ok(result.warnings.includes("ORDER_CONFIRMED_BY_DIRECT_ORDER_LOOKUP"));
  assert.equal(
    result.rawExchangePayload?.submissionDiagnostics?.localDerivedOrderId,
    "oid-local-derived-1",
  );
});

test("MARKET+FAK empty submission with no evidence returns FAK_NOT_FILLED (baseline orders filtered)", async () => {
  const signal = createSignal({ side: "BUY", intentType: "MARKET" });
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "MARKET",
    amount: 5,
    timeInForce: "FAK",
  };

  const { engine } = createEngine({
    intent,
    clobOverrides: {
      async postOrder() {
        return "";
      },
      async getOpenOrders() {
        return [
          {
            id: "oid-existing-1",
            asset_id: "123",
            side: "BUY",
            price: "0.66",
            original_size: "5",
            created_at: Date.now() - 60_000,
          },
        ];
      },
      async getTrades() {
        return [];
      },
    },
  });

  // FAK/FOK orders with NO_MATCH evidence are not errors — the order was
  // submitted but didn't fill, which is expected behaviour for FAK.
  const result = await engine.executeSkillSignal(signal, { countryCode: "SG" });
  assert.equal(result.accepted, true);
  assert.equal(result.finalStatus, "FAK_NOT_FILLED");
  assert.deepEqual(result.orderIds, []);
  assert.ok(
    result.warnings.includes("FAK_NO_FILL_EVIDENCE_AFTER_CONFIRMATION"),
  );
  assert.equal(
    result.rawExchangePayload?.submissionDiagnostics?.matchResult?.mode,
    "NO_MATCH",
  );
});

test("placeIntent confirms empty submission from unique trade taker_order_id evidence", async () => {
  const signal = createSignal({ side: "BUY", intentType: "MARKET" });
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "MARKET",
    amount: 5,
    limitPrice: 0.59,
    timeInForce: "FAK",
  };

  const { engine } = createEngine({
    intent,
    clobOverrides: {
      async postOrder() {
        return "";
      },
      async getOpenOrders() {
        return [];
      },
      async getTrades() {
        return [
          {
            id: "trade-1",
            taker_order_id: "oid-from-trade-1",
            asset_id: "123",
            side: "BUY",
            price: "0.57",
            size: "2.5",
          },
        ];
      },
    },
  });

  const result = await engine.executeSkillSignal(signal, { countryCode: "SG" });
  assert.equal(result.accepted, true);
  assert.equal(result.finalStatus, "CONFIRMED_BY_SYNC");
  assert.deepEqual(result.orderIds, ["oid-from-trade-1"]);
  assert.ok(result.warnings.includes("ORDER_CONFIRMED_BY_TRADE_ORDER_ID"));
});

test("placeIntent fails when trade matches but carries no candidate order id", async () => {
  const signal = createSignal({ side: "BUY", intentType: "LIMIT" });
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "LIMIT",
    size: 5,
    limitPrice: 0.59,
    timeInForce: "GTC",
  };

  const { engine } = createEngine({
    intent,
    clobOverrides: {
      async postOrder() {
        return "";
      },
      async getOpenOrders() {
        return [];
      },
      async getTrades() {
        return [
          {
            id: "trade-1",
            asset_id: "123",
            side: "BUY",
            price: "0.58",
            size: "5",
          },
        ];
      },
    },
  });

  await assert.rejects(
    async () => {
      await engine.executeSkillSignal(signal, { countryCode: "SG" });
    },
    (error) => {
      assert.equal(error instanceof RiskBlockedError, true);
      assert.equal(error.details?.errorCode, "ORDER_SUBMISSION_UNCONFIRMED");
      assert.equal(
        error.details?.submissionDiagnostics?.matchResult?.mode,
        "TRADE_MATCH_WITHOUT_ORDER_ID",
      );
      return true;
    },
  );
});

test("placeIntent confirms empty submission from notification order_id evidence", async () => {
  const signal = createSignal({ side: "BUY", intentType: "MARKET" });
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "MARKET",
    amount: 5,
    timeInForce: "FAK",
  };

  const { engine } = createEngine({
    intent,
    clobOverrides: {
      async postOrder() {
        return "";
      },
      async getOpenOrders() {
        return [];
      },
      async getTrades() {
        return [];
      },
      async getNotifications() {
        this.__notificationCalls = (this.__notificationCalls ?? 0) + 1;
        if (this.__notificationCalls === 1) return [];
        return [
          {
            id: "notification-1",
            timestamp: new Date().toISOString(),
            payload: {
              asset_id: "123",
              condition_id: "0xabc",
              side: "BUY",
              order_id: "oid-from-notification-1",
              matched_size: "1.2",
              price: "0.61",
              type: "FAK",
            },
          },
        ];
      },
    },
  });

  const result = await engine.executeSkillSignal(signal, { countryCode: "SG" });
  assert.equal(result.accepted, true);
  assert.equal(result.finalStatus, "CONFIRMED_BY_SYNC");
  assert.deepEqual(result.orderIds, ["oid-from-notification-1"]);
  assert.ok(
    result.warnings.includes("ORDER_CONFIRMED_BY_NOTIFICATION_ORDER_ID"),
  );
});

test("placeIntent fails on ambiguous derived order ids from notifications", async () => {
  const signal = createSignal({ side: "BUY", intentType: "MARKET" });
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "MARKET",
    amount: 5,
    timeInForce: "FAK",
  };

  const { engine } = createEngine({
    intent,
    clobOverrides: {
      async postOrder() {
        return "";
      },
      async getOpenOrders() {
        return [];
      },
      async getTrades() {
        return [];
      },
      async getNotifications() {
        this.__notificationCalls = (this.__notificationCalls ?? 0) + 1;
        if (this.__notificationCalls === 1) return [];
        return [
          {
            id: "notification-1",
            timestamp: new Date().toISOString(),
            payload: {
              asset_id: "123",
              condition_id: "0xabc",
              side: "BUY",
              order_id: "oid-notification-a",
              matched_size: "1.1",
            },
          },
          {
            id: "notification-2",
            timestamp: new Date().toISOString(),
            payload: {
              asset_id: "123",
              condition_id: "0xabc",
              side: "BUY",
              order_id: "oid-notification-b",
              matched_size: "1.3",
            },
          },
        ];
      },
    },
  });

  await assert.rejects(
    async () => {
      await engine.executeSkillSignal(signal, { countryCode: "SG" });
    },
    (error) => {
      assert.equal(error instanceof RiskBlockedError, true);
      assert.equal(error.details?.errorCode, "ORDER_SUBMISSION_UNCONFIRMED");
      assert.equal(
        error.details?.submissionDiagnostics?.matchResult?.mode,
        "AMBIGUOUS_ORDER_ID_EVIDENCE",
      );
      return true;
    },
  );
});

test("placeIntent fails when upstream submission throws explicit error payload", async () => {
  const signal = createSignal({ side: "BUY", intentType: "LIMIT" });
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "LIMIT",
    size: 5,
    limitPrice: 0.59,
    timeInForce: "GTC",
  };

  const { engine } = createEngine({
    intent,
    clobOverrides: {
      async postOrder() {
        const error = new Error("submission rejected");
        error.details = { code: "ORDER_SUBMISSION_REJECTED" };
        throw error;
      },
    },
  });

  await assert.rejects(
    async () => {
      await engine.executeSkillSignal(signal, { countryCode: "SG" });
    },
    (error) => {
      assert.equal(error instanceof RiskBlockedError, true);
      assert.equal(error.details?.errorCode, "ORDER_SUBMISSION_REJECTED");
      return true;
    },
  );
});

// ─── Fix: tickSize must be a string, not a number ───────────────────────
test("placeIntent passes tickSize as a string to createOrder options (SDK TickSize type)", async () => {
  const signal = createSignal({ side: "BUY", intentType: "LIMIT" });
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "LIMIT",
    size: 5,
    limitPrice: 0.55,
    timeInForce: "GTC",
  };
  const { engine, calls } = createEngine({ intent });

  await engine.executeSkillSignal(signal, { countryCode: "SG" });

  assert.equal(typeof calls.createOrderArgs.options.tickSize, "string");
  assert.equal(calls.createOrderArgs.options.tickSize, "0.01");
});

// ─── Fix: postOnly forced to false for FAK/FOK orders ──────────────────
test("placeIntent forces postOnly=false for LIMIT+FAK even when intent has postOnly=true", async () => {
  const signal = createSignal({ side: "BUY", intentType: "LIMIT" });
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "LIMIT",
    size: 5,
    limitPrice: 0.55,
    timeInForce: "FAK",
    postOnly: true,
  };
  const { engine, calls } = createEngine({
    intent,
    clobOverrides: {
      async postOrder(order, orderType, deferExec, postOnly) {
        calls.postOrder += 1;
        calls.postOrderArgs = { order, orderType, deferExec, postOnly };
        return { status: "matched", orderID: "oid-fak-1", success: true };
      },
    },
  });

  const result = await engine.executeSkillSignal(signal, { countryCode: "SG" });

  assert.equal(result.accepted, true);
  // postOnly must have been forced to false since FAK is incompatible
  assert.equal(calls.postOrderArgs.postOnly, false);
  assert.ok(result.warnings.includes("POST_ONLY_DOWNGRADED_FOR_FAK_FOK"));
});

// ─── Fix: FAK matched by response metadata without explicit orderID ────
test("placeIntent detects FAK success from response metadata when orderID is missing", async () => {
  const signal = createSignal({ side: "BUY", intentType: "MARKET" });
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "MARKET",
    amount: 10,
    limitPrice: 0.59,
    timeInForce: "FAK",
  };

  const { engine } = createEngine({
    intent,
    clobOverrides: {
      // Response indicates success but has no orderID field
      async postOrder() {
        return {
          success: true,
          status: "matched",
          transactionsHashes: ["0xdeadbeef"],
          takingAmount: "100000",
          makingAmount: "59000",
          orderID: "",
        };
      },
      async getOpenOrders() {
        return [];
      },
      async getTrades() {
        return [];
      },
    },
  });

  const result = await engine.executeSkillSignal(signal, { countryCode: "SG" });

  assert.equal(result.accepted, true);
  assert.equal(result.finalStatus, "FAK_MATCHED");
  assert.ok(result.warnings.includes("FAK_MATCHED_BY_RESPONSE_METADATA"));
  // Should NOT be FAK_NOT_FILLED — that would be a false negative
  assert.notEqual(result.finalStatus, "FAK_NOT_FILLED");
});

test("placeIntent treats FAK with success:false as normal empty submission (enters confirmation loop)", async () => {
  const signal = createSignal({ side: "BUY", intentType: "MARKET" });
  const intent = {
    tokenId: "123",
    conditionId: "0xabc",
    side: "BUY",
    orderType: "MARKET",
    amount: 10,
    limitPrice: 0.59,
    timeInForce: "FAK",
  };

  const { engine } = createEngine({
    intent,
    clobOverrides: {
      // Response indicates failure — no match, no fill
      async postOrder() {
        return {
          success: false,
          errorMsg: "no match",
          status: "",
          orderID: "",
        };
      },
      async getOpenOrders() {
        return [];
      },
      async getTrades() {
        return [];
      },
    },
  });

  const result = await engine.executeSkillSignal(signal, { countryCode: "SG" });

  // Since success is false, isFakSuccessResponse returns false,
  // enters confirmation loop → finds nothing → FAK_NOT_FILLED
  assert.equal(result.accepted, true);
  assert.equal(result.finalStatus, "FAK_NOT_FILLED");
});
