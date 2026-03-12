import test from "node:test";
import assert from "node:assert/strict";
import { PolymarketGateway } from "../src/openclaw/polymarket/polymarketGateway.mjs";
import { ValidationError } from "../src/openclaw/polymarket/errors.mjs";

const MARKET_ID_553825 = "553825";
const CONDITION_ID_553825 = "0xd01354f96db7fc2184cc34ac463a80cc65e7ff5de64c8a2f3e07e8433317d75f";
const TOKEN_ID_YES_553825 = "80061984358752599784693370376997592727558961379567449932508186368496986212029";
const TOKEN_ID_NO_553825 = "42433583546409205693938411606863251812283085544286252379883028411752918173253";

function createGatewayLike() {
  return {
    gamma: {
      async getMarkets(query) {
        assert.deepEqual(query, { id: MARKET_ID_553825, limit: 1 });
        return [
          {
            id: MARKET_ID_553825,
            conditionId: CONDITION_ID_553825,
            clobTokenIds: [TOKEN_ID_YES_553825, TOKEN_ID_NO_553825],
          },
        ];
      },
    },
  };
}

test("resolveOrderMarketContext resolves marketId=553825 to canonical conditionId and validates token membership", async () => {
  const gatewayLike = createGatewayLike();
  const input = {
    marketId: 553825,
    tokenId: TOKEN_ID_YES_553825,
    conditionId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    side: "BUY",
    orderType: "LIMIT",
    size: 5,
    limitPrice: 0.2,
  };

  const resolved = await PolymarketGateway.prototype.resolveOrderMarketContext.call(gatewayLike, input);

  assert.equal(resolved.marketId, MARKET_ID_553825);
  assert.equal(resolved.conditionId, CONDITION_ID_553825);
  assert.equal(resolved.tokenId, TOKEN_ID_YES_553825);
});

test("resolveOrderMarketContext rejects tokenId that does not belong to marketId=553825", async () => {
  const gatewayLike = createGatewayLike();
  const input = {
    marketId: 553825,
    tokenId: "99999999999999999999999999999999999999999999999999999999999999999999",
    side: "BUY",
    orderType: "LIMIT",
    size: 5,
    limitPrice: 0.2,
  };

  await assert.rejects(
    async () => {
      await PolymarketGateway.prototype.resolveOrderMarketContext.call(gatewayLike, input);
    },
    (error) => {
      assert.equal(error instanceof ValidationError, true);
      assert.match(String(error.message), /does not belong to marketId=553825/i);
      return true;
    },
  );
});

test("resolveOrderMarketContext requires explicit tokenId when marketId resolves to multiple tokens", async () => {
  const gatewayLike = createGatewayLike();
  const input = {
    marketId: 553825,
    side: "BUY",
    orderType: "LIMIT",
    size: 5,
    limitPrice: 0.2,
  };

  await assert.rejects(
    async () => {
      await PolymarketGateway.prototype.resolveOrderMarketContext.call(gatewayLike, input);
    },
    (error) => {
      assert.equal(error instanceof ValidationError, true);
      assert.match(String(error.message), /tokenId is required/i);
      return true;
    },
  );
});

test("resolveOrderMarketContext accepts conditionId hash without marketId lookup", async () => {
  const gatewayLike = {
    gamma: {
      async getMarkets() {
        throw new Error("should not call gamma.getMarkets when marketId is missing");
      },
    },
  };
  const input = {
    tokenId: TOKEN_ID_NO_553825,
    conditionId: CONDITION_ID_553825,
    side: "SELL",
    orderType: "LIMIT",
    size: 5,
    limitPrice: 0.8,
  };

  const resolved = await PolymarketGateway.prototype.resolveOrderMarketContext.call(gatewayLike, input);
  assert.equal(resolved.conditionId, CONDITION_ID_553825);
  assert.equal(resolved.tokenId, TOKEN_ID_NO_553825);
});
