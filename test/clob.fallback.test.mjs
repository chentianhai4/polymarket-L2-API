import test from "node:test";
import assert from "node:assert/strict";
import { ClobService } from "../src/openclaw/polymarket/clients/clobService.mjs";
import { ClobClient } from "@polymarket/clob-client";

const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945382d6f8c8f4e58f87bff1c8f17f7d5f9a22";
const TEST_FUNDER = "0x1111111111111111111111111111111111111111";

function buildConfig() {
  return {
    chainId: 137,
    clobHost: "https://clob.polymarket.com",
    requestTimeoutMs: 30000,
    proxyUrl: "http://127.0.0.1:10077",
    maxBatchOrders: 15,
    retry: { retries: 0, baseDelayMs: 1, maxDelayMs: 1, factor: 1 },
    rateLimits: {
      clob: { requestsPerSecond: 10, concurrency: 2 },
    },
  };
}

test("getPrice falls back to HTTP when clob-client returns invalid empty payload", async () => {
  const clob = new ClobService({
    config: { ...buildConfig(), proxyUrl: null },
    privateKey: TEST_PRIVATE_KEY,
    signatureType: 2,
    funderAddress: TEST_FUNDER,
  });

  clob.client = {
    async getPrice() {
      return "";
    },
  };

  let called = false;
  clob.http = {
    async get(url, query) {
      called = true;
      assert.match(url, /\/price$/);
      assert.equal(query.token_id, "123");
      assert.equal(query.side, "BUY");
      return { data: { price: "0.42", side: "BUY" } };
    },
  };

  const result = await clob.getPrice("123", "BUY");
  assert.equal(called, true);
  assert.deepEqual(result, { price: "0.42", side: "BUY" });
});

test("buildClient proxy patches getTickSize/getFeeRateBps/getNegRisk and writes cache", async () => {
  const clob = new ClobService({
    config: buildConfig(),
    privateKey: TEST_PRIVATE_KEY,
    signatureType: 2,
    funderAddress: TEST_FUNDER,
  });

  const calls = [];
  clob.getPublicClob = async (path, query) => {
    calls.push({ path, query });
    assert.equal(query.token_id, "123");
    if (path === "/tick-size") return { minimum_tick_size: "0.01" };
    if (path === "/fee-rate") return { base_fee: 12 };
    if (path === "/neg-risk") return { neg_risk: true };
    throw new Error(`Unexpected path: ${path}`);
  };

  const client = clob.buildClient();

  const tickSize = await client.getTickSize("123");
  const feeRate = await client.getFeeRateBps("123");
  const negRisk = await client.getNegRisk("123");

  assert.equal(tickSize, "0.01");
  assert.equal(feeRate, 12);
  assert.equal(negRisk, true);
  assert.equal(client.tickSizes["123"], "0.01");
  assert.equal(client.feeRates["123"], 12);
  assert.equal(client.negRisk["123"], true);
  assert.deepEqual(
    calls.map((x) => x.path),
    ["/tick-size", "/fee-rate", "/neg-risk"],
  );
});

test("buildClient proxy patches client.post and keeps geo_block_token query", async () => {
  const clob = new ClobService({
    config: buildConfig(),
    privateKey: TEST_PRIVATE_KEY,
    signatureType: 2,
    funderAddress: TEST_FUNDER,
    geoBlockToken: "geo-test-token",
  });

  let called = false;
  clob.http = {
    async post(url, body, headers, query) {
      called = true;
      assert.match(url, /\/order$/);
      assert.equal(query.geo_block_token, "geo-test-token");
      assert.deepEqual(body, { hello: "world" });
      assert.equal(headers["X-Test"], "1");
      return { data: { orderID: "oid-http" } };
    },
  };

  const client = clob.buildClient();
  const payload = await client.post(`${buildConfig().clobHost}/order`, {
    headers: { "X-Test": "1" },
    data: { hello: "world" },
  });

  assert.equal(called, true);
  assert.deepEqual(payload, { orderID: "oid-http" });
});

test("buildClient throws when proxy /order returns invalid empty payload on all transport modes", async () => {
  const originalPost = ClobClient.prototype.post;
  try {
    ClobClient.prototype.post = async () => ({ orderID: "oid-sdk" });

    const clob = new ClobService({
      config: buildConfig(),
      privateKey: TEST_PRIVATE_KEY,
      signatureType: 2,
      funderAddress: TEST_FUNDER,
      geoBlockToken: "geo-test-token",
    });

    let httpCalls = 0;
    clob.http = {
      async post() {
        httpCalls += 1;
        return { data: "" };
      },
    };

    const client = clob.buildClient();
    // In proxy mode, order endpoints now only use "http" transport (SDK
    // native axios can't use our proxy), so an empty payload should throw
    // instead of silently returning an invalid-submission marker.
    await assert.rejects(
      () =>
        client.post(`${buildConfig().clobHost}/order`, {
          headers: { "X-Test": "1" },
          data: { hello: "world" },
        }),
      (err) => {
        assert.equal(err.details?.code, "ORDER_SUBMISSION_ALL_INVALID");
        return true;
      },
    );

    assert.equal(httpCalls, 1);
  } finally {
    ClobClient.prototype.post = originalPost;
  }
});

test("createAndPostOrder marks empty submission payload as invalid instead of success", async () => {
  const clob = new ClobService({
    config: buildConfig(),
    privateKey: TEST_PRIVATE_KEY,
    signatureType: 2,
    funderAddress: TEST_FUNDER,
  });

  clob.client = {
    async createAndPostOrder() {
      return "";
    },
  };

  const payload = await clob.createAndPostOrder({
    tokenID: "123",
    price: 0.5,
    size: 5,
    side: "BUY",
  });
  assert.equal(clob.isInvalidOrderSubmissionPayload(payload), true);
  assert.equal(payload.__openclawInvalidSubmission, true);
  assert.equal(payload.initialPayload, "");
});

test("postOrder marks empty submission payload as invalid instead of success", async () => {
  const clob = new ClobService({
    config: buildConfig(),
    privateKey: TEST_PRIVATE_KEY,
    signatureType: 2,
    funderAddress: TEST_FUNDER,
  });

  clob.client = {
    async postOrder() {
      return "";
    },
  };

  const payload = await clob.postOrder(
    { tokenID: "123", price: 0.5, size: 5, side: "BUY" },
    "GTC",
  );
  assert.equal(clob.isInvalidOrderSubmissionPayload(payload), true);
  assert.equal(payload.__openclawInvalidSubmission, true);
  assert.equal(payload.initialPayload, "");
});

test("toUserMarketOrder prioritizes intent.amount over legacy size", async () => {
  const clob = new ClobService({
    config: buildConfig(),
    privateKey: TEST_PRIVATE_KEY,
    signatureType: 2,
    funderAddress: TEST_FUNDER,
  });

  const order = clob.toUserMarketOrder({
    tokenId: "123",
    side: "BUY",
    amount: 12.5,
    size: 99,
    timeInForce: "FAK",
  });

  assert.equal(order.amount, 12.5);
  assert.equal(order.orderType, "FAK");
});

test("extractOrderIds supports multiple upstream field names", async () => {
  const clob = new ClobService({
    config: buildConfig(),
    privateKey: TEST_PRIVATE_KEY,
    signatureType: 2,
    funderAddress: TEST_FUNDER,
  });

  const payload = {
    orderID: "oid-1",
    orderIds: ["oid-2"],
    data: {
      order_hash: "oid-3",
      result: [{ hash: "oid-4" }],
    },
  };

  assert.deepEqual(clob.extractOrderIds(payload), [
    "oid-1",
    "oid-2",
    "oid-3",
    "oid-4",
  ]);
});

test("getOpenOrders falls back to HTTP and injects default query fields", async () => {
  const clob = new ClobService({
    config: buildConfig(),
    privateKey: TEST_PRIVATE_KEY,
    signatureType: 2,
    funderAddress: TEST_FUNDER,
  });

  clob.client = {
    async getOpenOrders() {
      throw new Error("sdk timeout");
    },
  };

  clob.createL2Headers = async (path, method) => {
    assert.equal(path, "/data/orders");
    assert.equal(method, "GET");
    return { "X-Poly-Sig": "sig" };
  };

  clob.http = {
    async get(url, query, headers) {
      assert.match(url, /\/data\/orders$/);
      assert.equal(query.maker_address, TEST_FUNDER);
      assert.equal(query.signature_type, 2);
      assert.equal(query.next_cursor, "MA==");
      assert.equal(headers["X-Poly-Sig"], "sig");
      return { data: [{ id: "order-1" }] };
    },
  };

  const result = await clob.getOpenOrders({}, true);
  assert.deepEqual(result, [{ id: "order-1" }]);
});

test("getTrades fallback keeps taker query without injecting maker_address", async () => {
  const clob = new ClobService({
    config: buildConfig(),
    privateKey: TEST_PRIVATE_KEY,
    signatureType: 2,
    funderAddress: TEST_FUNDER,
  });

  clob.client = {
    async getTrades() {
      throw new Error("sdk timeout");
    },
  };

  clob.createL2Headers = async (path, method) => {
    assert.equal(path, "/data/trades");
    assert.equal(method, "GET");
    return { "X-Poly-Sig": "sig" };
  };

  clob.http = {
    async get(url, query, headers) {
      assert.match(url, /\/data\/trades$/);
      assert.equal(query.taker, "0xtaker000000000000000000000000000000000001");
      assert.equal("maker_address" in query, false);
      assert.equal(query.signature_type, 2);
      assert.equal(query.next_cursor, "MA==");
      assert.equal(headers["X-Poly-Sig"], "sig");
      return { data: [{ id: "trade-1" }] };
    },
  };

  const result = await clob.getTrades(
    { taker: "0xtaker000000000000000000000000000000000001" },
    true,
  );
  assert.deepEqual(result, [{ id: "trade-1" }]);
});
