import test from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../src/openclaw/polymarket/http/rateLimiter.mjs";

test("RateLimiter runs scheduled jobs", async () => {
  const limiter = new RateLimiter({ requestsPerSecond: 20, concurrency: 2 });
  const seen = [];

  await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      limiter.schedule(async () => {
        seen.push(i);
      }),
    ),
  );

  assert.equal(seen.length, 5);
});
