import { PolymarketGateway } from "../index.mjs";

const gateway = new PolymarketGateway({
  // Will fallback to .env values if omitted.
  privateKey: process.env.PRIVATE_KEY,
  funderAddress: process.env.FUNDER_ADDRESS,
  signatureType: Number(process.env.SIGNATURE_TYPE ?? "2"),
  apiKey: process.env.API_KEY,
  secret: process.env.SECRET,
  passphrase: process.env.PASSPHRASE,
});

const init = await gateway.initialize({ autoAuth: true });
console.log("Initialized:", init);

const marketResults = await gateway.discoverMarkets({ limit: 5 });
console.log("Discovered markets:", marketResults.length);

if (marketResults[0]) {
  const market = marketResults[0];
  const parsedTokenIds =
    typeof market.clobTokenIds === "string"
      ? (() => {
          try {
            return JSON.parse(market.clobTokenIds);
          } catch {
            return [];
          }
        })()
      : market.clobTokenIds;
  const tokenId =
    parsedTokenIds?.[0] ??
    market.clob_token_ids?.[0] ??
    market.tokens?.[0]?.id ??
    market.tokens?.[0]?.token_id;

  if (tokenId) {
    const quote = await gateway.getQuote({ tokenId, side: "BUY" });
    console.log("Quote:", JSON.stringify(quote, null, 2));
  }
}

console.log("Metrics:", gateway.metricsSnapshot());
