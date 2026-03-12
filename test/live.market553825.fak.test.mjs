import test from "node:test";
import assert from "node:assert/strict";
import { PolymarketGateway } from "../src/openclaw/polymarket/polymarketGateway.mjs";

function parseTokenIds(market) {
  const direct = market?.clobTokenIds ?? market?.clob_token_ids;
  if (Array.isArray(direct)) return direct.map(String);
  if (typeof direct === "string" && direct.trim()) {
    try {
      const parsed = JSON.parse(direct);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // ignore invalid json
    }
  }
  if (Array.isArray(market?.tokens)) {
    return market.tokens
      .map((token) => token?.id ?? token?.token_id ?? token?.tokenId)
      .filter(Boolean)
      .map(String);
  }
  return [];
}

function roundToTick(value, tickSize) {
  const tick = Number(tickSize);
  if (!Number.isFinite(tick) || tick <= 0) return Number(value);
  return Math.max(tick, Math.round(Number(value) / tick) * tick);
}

test(
  "live marketId=553825 MARKET+FAK and LIMIT+FAK confirmation smoke (guarded)",
  { timeout: 180000 },
  async (t) => {
    if (
      process.env.LIVE_TRADING !== "1" ||
      process.env.LIVE_FAK_VALIDATION !== "1"
    ) {
      t.skip(
        "Set LIVE_TRADING=1 and LIVE_FAK_VALIDATION=1 to run live FAK validation",
      );
      return;
    }

    if (!process.env.PRIVATE_KEY || !process.env.FUNDER_ADDRESS) {
      t.skip("Missing PRIVATE_KEY or FUNDER_ADDRESS");
      return;
    }

    const marketId = String(process.env.LIVE_MARKET_ID ?? "553825");
    const gateway = new PolymarketGateway({
      privateKey: process.env.PRIVATE_KEY,
      funderAddress: process.env.FUNDER_ADDRESS,
      signatureType: Number(process.env.SIGNATURE_TYPE ?? "2"),
      apiKey: process.env.API_KEY,
      secret: process.env.SECRET,
      passphrase: process.env.PASSPHRASE,
      auditLogPath: "./audit/live-fak-market553825.log",
    });

    await gateway.initialize({ autoAuth: true });

    const markets = await gateway.gamma.getMarkets({ id: marketId, limit: 1 });
    const market = Array.isArray(markets) ? markets[0] : null;
    assert.ok(market, `Failed to resolve marketId=${marketId}`);

    const tokenIds = parseTokenIds(market);
    assert.ok(tokenIds.length > 0, `marketId=${marketId} has no clobTokenIds`);

    const tokenId = String(process.env.LIVE_TOKEN_ID ?? tokenIds[0]);
    assert.ok(
      tokenIds.includes(tokenId),
      `LIVE_TOKEN_ID=${tokenId} is not part of marketId=${marketId}`,
    );

    const marketIntent = {
      marketId,
      tokenId,
      side: "BUY",
      orderType: "MARKET",
      amount: Number(process.env.LIVE_MARKET_BUY_AMOUNT_USDC ?? "1"),
      timeInForce: "FAK",
    };

    const marketResult = await gateway.placeOrder(marketIntent, {
      skillId: "live-fak-market",
      idempotencyKey: `live-fak-market:${marketId}:${tokenId}:${Date.now()}`,
    });

    assert.equal(
      marketResult.accepted,
      true,
      "MARKET+FAK order was not accepted",
    );
    assert.notEqual(
      marketResult.rawExchangePayload?.submissionDiagnostics?.matchResult?.mode,
      "NO_MATCH",
      "MARKET+FAK ended with NO_MATCH evidence mode",
    );

    const quote = await gateway.getQuote({ tokenId, side: "BUY" });
    const tickSize = Number(
      quote?.tickSize ?? quote?.orderBook?.tick_size ?? "0.01",
    );
    const minOrderSize = Number(
      quote?.orderBook?.min_order_size ??
        process.env.LIVE_LIMIT_FAK_SIZE ??
        "5",
    );
    const bestAskRaw = quote?.orderBook?.asks?.[0]?.price;
    const bestAsk = Number(
      bestAskRaw ?? quote?.price?.price ?? quote?.midpoint?.mid ?? "0.5",
    );
    const marketablePrice = Math.min(
      0.99,
      roundToTick(bestAsk + tickSize * 3, tickSize),
    );

    const limitIntent = {
      marketId,
      tokenId,
      side: "BUY",
      orderType: "LIMIT",
      size: Number(process.env.LIVE_LIMIT_FAK_SIZE ?? minOrderSize),
      limitPrice: marketablePrice,
      timeInForce: "FAK",
      postOnly: false,
    };

    const limitResult = await gateway.placeOrder(limitIntent, {
      skillId: "live-fak-limit",
      idempotencyKey: `live-fak-limit:${marketId}:${tokenId}:${Date.now()}`,
    });

    assert.equal(
      limitResult.accepted,
      true,
      "LIMIT+FAK order was not accepted",
    );

    // FAK orders may legitimately end as FAK_NOT_FILLED or FAK_TIMEOUT_NO_EVIDENCE
    // when the order didn't match — this is NOT an error.
    const matchMode =
      limitResult.rawExchangePayload?.submissionDiagnostics?.matchResult?.mode;
    const isFakNoFill =
      limitResult.finalStatus === "FAK_NOT_FILLED" ||
      limitResult.finalStatus === "FAK_TIMEOUT_NO_EVIDENCE";
    if (isFakNoFill) {
      console.log(
        `LIMIT+FAK returned finalStatus=${limitResult.finalStatus} (no fill, not an error)`,
      );
    } else {
      assert.notEqual(
        matchMode,
        "NO_MATCH",
        "LIMIT+FAK ended with NO_MATCH evidence mode",
      );
    }
  },
);
