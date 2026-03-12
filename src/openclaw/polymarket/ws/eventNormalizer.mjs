export function normalizeRealtimeEvent(raw) {
  if (!raw || typeof raw !== "object") {
    return { type: "unknown", payload: raw, receivedAt: Date.now() };
  }

  const eventType = raw.event_type ?? raw.type ?? raw.channel ?? "unknown";

  if (eventType === "price_change") {
    return normalizePriceChange(raw);
  }

  if (["book", "book_update", "orderbook"].includes(eventType)) {
    return {
      type: "book",
      payload: {
        tokenId: raw.asset_id ?? raw.token_id ?? raw.tokenId,
        market: raw.market ?? raw.condition_id,
        bids: raw.bids ?? [],
        asks: raw.asks ?? [],
        timestamp: raw.timestamp ?? Date.now(),
      },
      receivedAt: Date.now(),
      raw,
    };
  }

  if (["last_trade_price", "trade", "order", "notification"].includes(eventType)) {
    return {
      type: eventType,
      payload: raw,
      receivedAt: Date.now(),
      raw,
    };
  }

  return {
    type: "unknown",
    payload: raw,
    receivedAt: Date.now(),
    raw,
  };
}

function normalizePriceChange(raw) {
  const market = raw.market ?? {};
  const payload = raw.payload ?? raw;

  const changes = Array.isArray(payload?.changes)
    ? payload.changes
    : [
        {
          tokenId: payload.asset_id ?? payload.token_id ?? payload.tokenId,
          price: payload.price ?? payload.last_price,
          bestBid: payload.best_bid,
          bestAsk: payload.best_ask,
        },
      ];

  return {
    type: "price_change",
    payload: {
      market: market.condition_id ?? payload.condition_id ?? payload.market,
      timestamp: payload.timestamp ?? raw.timestamp ?? Date.now(),
      changes: changes
        .filter((item) => item && (item.tokenId ?? item.asset_id ?? item.token_id))
        .map((item) => ({
          tokenId: item.tokenId ?? item.asset_id ?? item.token_id,
          price: Number(item.price ?? item.last_price ?? 0),
          bestBid: item.bestBid ?? item.best_bid,
          bestAsk: item.bestAsk ?? item.best_ask,
        })),
    },
    receivedAt: Date.now(),
    raw,
  };
}
