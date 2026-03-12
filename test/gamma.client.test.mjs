import test from "node:test";
import assert from "node:assert/strict";
import { GammaClient } from "../src/openclaw/polymarket/clients/gammaClient.mjs";
import { createPolymarketConfig } from "../src/openclaw/polymarket/config.mjs";

function buildClient() {
  const config = createPolymarketConfig({ proxyUrl: null });
  return new GammaClient({ config });
}

test("GammaClient.search uses /public-search and maps limit to limit_per_type", async () => {
  const client = buildClient();
  const calls = [];
  client.http.get = async (url, query) => {
    calls.push({ url, query });
    return { data: { events: [], pagination: {} } };
  };

  await client.search({ q: "politics", limit: 50 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://gamma-api.polymarket.com/public-search");
  assert.equal(calls[0].query.q, "politics");
  assert.equal(calls[0].query.limit, 50);
  assert.equal(calls[0].query.limit_per_type, 50);
});

test("GammaClient.discover fallback flattens events[].markets and deduplicates by id/conditionId", async () => {
  const client = buildClient();
  client.getMarkets = async () => [];
  client.search = async () => ({
    markets: [
      { id: "m1", slug: "market-1" },
      { conditionId: "c2", slug: "market-2" },
    ],
    events: [
      {
        markets: [
          { id: "m1", slug: "market-1-dup" },
          { condition_id: "c2", slug: "market-2-dup" },
          { id: "m3", slug: "market-3" },
        ],
      },
    ],
  });

  const markets = await client.discover({ query: "politics", limit: 50, active: true, tradableOnly: false });

  assert.equal(markets.length, 3);
  assert.deepEqual(
    markets.map((m) => m.id ?? m.conditionId ?? m.condition_id),
    ["m1", "c2", "m3"],
  );
});

test("GammaClient.discover fallback returns empty array when public-search has no markets", async () => {
  const client = buildClient();
  client.getMarkets = async () => [];
  client.search = async () => ({
    events: [{ id: "e1" }],
    profiles: [{ id: "p1" }],
  });

  const markets = await client.discover({ query: "politics", limit: 10 });
  assert.deepEqual(markets, []);
});

test("GammaClient.discover keeps primary market path when filtered markets are found", async () => {
  const client = buildClient();
  let searchCalled = false;
  client.getMarkets = async () => [
    { id: "m1", slug: "politics-market", question: "Politics question", clobTokenIds: ["1"] },
    { id: "m2", slug: "sports-market", question: "Sports question", clobTokenIds: ["2"] },
  ];
  client.search = async () => {
    searchCalled = true;
    return { markets: [{ id: "fallback", clobTokenIds: ["9"] }] };
  };

  const markets = await client.discover({ query: "politics", limit: 10, active: true });

  assert.equal(markets.length, 1);
  assert.equal(markets[0].id, "m1");
  assert.equal(searchCalled, false);
});

test("GammaClient.discover(active=true) defaults closed=false and returns tradable-only markets", async () => {
  const client = buildClient();
  let paramsSeen = null;
  client.getMarkets = async (params) => {
    paramsSeen = params;
    return [
      { id: "open-ok", closed: false, archived: false, clobTokenIds: ["100"] },
      { id: "closed-market", closed: true, archived: false, clobTokenIds: ["101"] },
      { id: "archived-market", closed: false, archived: true, clobTokenIds: ["102"] },
      { id: "no-token", closed: false, archived: false },
    ];
  };

  const markets = await client.discover({ active: true, limit: 20 });

  assert.equal(paramsSeen.active, true);
  assert.equal(paramsSeen.closed, false);
  assert.equal(markets.length, 1);
  assert.equal(markets[0].id, "open-ok");
});

test("GammaClient.discover allows explicit closed/archived query when tradableOnly is disabled", async () => {
  const client = buildClient();
  let paramsSeen = null;
  client.getMarkets = async (params) => {
    paramsSeen = params;
    return [{ id: "closed-1", closed: true, archived: false }];
  };

  const markets = await client.discover({
    active: true,
    closed: true,
    archived: false,
    tradableOnly: false,
    limit: 20,
  });

  assert.equal(paramsSeen.closed, true);
  assert.equal(paramsSeen.archived, false);
  assert.equal(markets.length, 1);
  assert.equal(markets[0].id, "closed-1");
});

test("GammaClient.discover(tags) uses event tags for exact matching by slug/id", async () => {
  const client = buildClient();
  let getMarketsCalled = false;
  const eventQueries = [];

  client.getMarkets = async () => {
    getMarketsCalled = true;
    return [];
  };
  client.getEvents = async (query) => {
    eventQueries.push(query);
    if (query.offset !== 0) return [];
    return [
      {
        id: "e-politics",
        tags: [{ id: "2", slug: "politics", label: "Politics" }],
        markets: [
          {
            id: "m1",
            slug: "politics-market",
            question: "Politics market",
            closed: false,
            archived: false,
            clobTokenIds: ["101"],
          },
          {
            id: "m1-closed",
            slug: "politics-market-closed",
            question: "Politics market closed",
            closed: true,
            archived: false,
            clobTokenIds: ["102"],
          },
        ],
      },
      {
        id: "e-related",
        tags: [{ id: "126", slug: "trump", label: "Trump" }],
        markets: [
          {
            id: "m2",
            slug: "trump-market",
            question: "Trump market",
            closed: false,
            archived: false,
            clobTokenIds: ["201"],
          },
        ],
      },
    ];
  };

  const bySlug = await client.discover({ tags: ["politics"], limit: 10, active: true });
  const byId = await client.discover({ tags: ["2"], limit: 10, active: true });

  assert.equal(getMarketsCalled, false);
  assert.equal(eventQueries.length, 4);
  assert.equal(eventQueries[0].active, true);
  assert.equal(eventQueries[0].closed, false);
  assert.equal(bySlug.length, 1);
  assert.equal(bySlug[0].id, "m1");
  assert.deepEqual(bySlug[0].tags, ["politics"]);
  assert.equal(byId.length, 1);
  assert.equal(byId[0].id, "m1");
});

test("GammaClient.discover(tags) does not match related tags when exact tag is absent", async () => {
  const client = buildClient();
  client.getMarkets = async () => {
    throw new Error("discover(tags) should not call getMarkets");
  };
  client.getEvents = async () => [
    {
      id: "e-related",
      tags: [{ id: "126", slug: "trump", label: "Trump" }],
      markets: [
        {
          id: "m1",
          slug: "trump-market",
          question: "Trump market",
          closed: false,
          archived: false,
          clobTokenIds: ["1"],
        },
      ],
    },
  ];

  const markets = await client.discover({ tags: ["politics"], limit: 10, active: true });
  assert.deepEqual(markets, []);
});

test("GammaClient.discover(tags) applies query/eventSlug/tradableOnly filters", async () => {
  const client = buildClient();
  client.getEvents = async () => [
    {
      id: "e-geo",
      tags: [{ id: "100265", slug: "geopolitics", label: "Geopolitics" }],
      markets: [
        {
          id: "m1",
          slug: "russia-ukraine-ceasefire-before-gta-vi",
          question: "Russia-Ukraine ceasefire before GTA VI?",
          closed: false,
          archived: false,
          clobTokenIds: ["11"],
        },
        {
          id: "m2",
          slug: "russia-ukraine-ceasefire-before-gta-vi",
          question: "Russia-Ukraine ceasefire before GTA VI? closed",
          closed: true,
          archived: false,
          clobTokenIds: ["12"],
        },
        {
          id: "m3",
          slug: "other-geo-market",
          question: "Other market",
          closed: false,
          archived: false,
          clobTokenIds: ["13"],
        },
      ],
    },
  ];

  const markets = await client.discover({
    tags: ["geopolitics"],
    query: "ceasefire",
    eventSlug: "russia-ukraine-ceasefire-before-gta-vi",
    tradableOnly: true,
    limit: 10,
    active: true,
  });

  assert.equal(markets.length, 1);
  assert.equal(markets[0].id, "m1");
});

test("GammaClient.discover(tags) paginates and stops once limit is reached", async () => {
  const client = buildClient();
  const calls = [];
  client.getEvents = async (query) => {
    calls.push(query);
    if (query.offset === 0) {
      return [
        {
          id: "e1",
          tags: [{ id: "2", slug: "politics" }],
          markets: [
            { id: "m1", slug: "m1", closed: false, archived: false, clobTokenIds: ["1"] },
          ],
        },
      ];
    }
    if (query.offset === 20) {
      return [
        {
          id: "e2",
          tags: [{ id: "2", slug: "politics" }],
          markets: [
            { id: "m2", slug: "m2", closed: false, archived: false, clobTokenIds: ["2"] },
            { id: "m3", slug: "m3", closed: false, archived: false, clobTokenIds: ["3"] },
            { id: "m4", slug: "m4", closed: false, archived: false, clobTokenIds: ["4"] },
          ],
        },
      ];
    }
    return [];
  };

  const markets = await client.discover({ tags: ["politics"], limit: 3, active: true });

  assert.deepEqual(
    markets.map((m) => m.id),
    ["m1", "m2", "m3"],
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].offset, 0);
  assert.equal(calls[1].offset, 20);
});
