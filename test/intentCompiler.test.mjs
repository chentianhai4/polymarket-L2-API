import test from "node:test";
import assert from "node:assert/strict";
import { IntentCompiler } from "../src/openclaw/polymarket/execution/intentCompiler.mjs";

test("IntentCompiler compiles signal into trade intent", () => {
  const compiler = new IntentCompiler();

  const intent = compiler.compile(
    {
      skillId: "skill-1",
      intentType: "LIMIT",
      marketSelector: { tokenId: "t1", conditionId: "c1" },
      side: "BUY",
      sizePolicy: { mode: "fixed", value: 10 },
      pricePolicy: { mode: "limit", value: 0.55 },
      riskPolicy: {},
      timeInForce: "GTC",
    },
    {},
  );

  assert.equal(intent.tokenId, "t1");
  assert.equal(intent.conditionId, "c1");
  assert.equal(intent.size, 10);
  assert.equal(intent.limitPrice, 0.55);
});
