export class QuoteService {
  constructor({ clobService }) {
    this.clob = clobService;
  }

  async getQuote(tokenId, side) {
    const [price, midpoint, spread, tickSize, feeRateBps, negRisk, orderBook] = await Promise.all([
      this.clob.getPrice(tokenId, side).catch(() => null),
      this.clob.getMidpoint(tokenId).catch(() => null),
      this.clob.getSpread(tokenId).catch(() => null),
      this.clob.getTickSize(tokenId).catch(() => null),
      this.clob.getFeeRateBps(tokenId).catch(() => null),
      this.clob.getNegRisk(tokenId).catch(() => null),
      this.clob.getOrderBook(tokenId).catch(() => null),
    ]);

    return {
      tokenId,
      side,
      price,
      midpoint,
      spread,
      tickSize,
      feeRateBps,
      negRisk,
      orderBook,
      fetchedAt: Date.now(),
    };
  }

  async getQuotes(items) {
    return await Promise.all(items.map((item) => this.getQuote(item.tokenId, item.side)));
  }
}
