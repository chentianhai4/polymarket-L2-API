import test from "node:test";
import assert from "node:assert/strict";
import { MarketDiscoveryService } from "../src/openclaw/polymarket/services/marketDiscoveryService.mjs";

test("MarketDiscoveryService.search matches tags across string/number/object shapes", async () => {
  const gammaClient = {
    async discover() {
      return [
        {
          id: "m1",
          slug: "politics-market",
          question: "Politics market",
          clobTokenIds: ["101"],
          tags: [{ slug: "politics", id: 2, label: "Politics" }],
        },
        {
          id: "m2",
          slug: "geopolitics-market",
          question: "Geopolitics market",
          clobTokenIds: ["102"],
          tags: "100265,geopolitics",
        },
        {
          id: "m3",
          slug: "trump-market",
          question: "Trump market",
          clobTokenIds: ["103"],
          tags: [{ slug: "trump", id: 126, label: "Trump" }],
        },
      ];
    },
  };

  const service = new MarketDiscoveryService({ gammaClient });
  await service.refresh({});

  const politicsBySlug = service.search({ tags: ["politics"] });
  assert.deepEqual(
    politicsBySlug.map((m) => m.id),
    ["m1"],
  );

  const politicsById = service.search({ tags: ["2"] });
  assert.deepEqual(
    politicsById.map((m) => m.id),
    ["m1"],
  );

  const geopolitics = service.search({ tags: ["geopolitics"] });
  assert.deepEqual(
    geopolitics.map((m) => m.id),
    ["m2"],
  );

  const combined = service.search({ tags: ["politics", "geopolitics"] });
  assert.deepEqual(
    combined.map((m) => m.id),
    ["m1", "m2"],
  );
});

test("MarketDiscoveryService.search keeps OR semantics for multiple tags", async () => {
  const gammaClient = {
    async discover() {
      return [
        {
          id: "m1",
          slug: "politics-market",
          question: "Politics market",
          clobTokenIds: ["201"],
          tags: [{ slug: "politics" }],
        },
        {
          id: "m2",
          slug: "geopolitics-market",
          question: "Geopolitics market",
          clobTokenIds: ["202"],
          tags: [{ slug: "geopolitics" }],
        },
      ];
    },
  };

  const service = new MarketDiscoveryService({ gammaClient });
  await service.refresh({});

  const result = service.search({ tags: ["politics", "non-existent-tag"] });
  assert.deepEqual(
    result.map((m) => m.id),
    ["m1"],
  );
});
