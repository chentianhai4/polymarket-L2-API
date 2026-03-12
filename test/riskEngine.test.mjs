import test from "node:test";
import assert from "node:assert/strict";
import { RiskEngine } from "../src/openclaw/polymarket/risk/riskEngine.mjs";
import { createPolymarketConfig } from "../src/openclaw/polymarket/config.mjs";

function mockClob({ closedOnly = false, minOrderSize = "1", tickSize = "0.01", feeRate = 10, negRisk = false } = {}) {
  return {
    async getClosedOnlyMode() {
      return { closed_only: closedOnly };
    },
    async getOrderBook() {
      return { min_order_size: minOrderSize, tick_size: tickSize };
    },
    async getFeeRateBps() {
      return feeRate;
    },
    async getNegRisk() {
      return negRisk;
    },
    async getBalanceAllowance() {
      return {
        balance: "100000000",
        allowances: { default: "1" },
      };
    },
  };
}

test("RiskEngine hard blocks when kill switch is enabled", async () => {
  const risk = new RiskEngine({ config: createPolymarketConfig(), clobService: mockClob() });
  risk.setKillSwitch(true);

  const decision = await risk.evaluate({ tokenId: "x", size: 10, limitPrice: 0.5, side: "BUY" }, { skillId: "s1" });

  assert.equal(decision.decision, "HARD_BLOCK");
  assert.ok(decision.reasonCodes.includes("KILL_SWITCH"));
});

test("RiskEngine allows basic valid order", async () => {
  const risk = new RiskEngine({ config: createPolymarketConfig(), clobService: mockClob() });
  const decision = await risk.evaluate({ tokenId: "x", size: 10, limitPrice: 0.5, side: "BUY" }, { skillId: "s1" });
  assert.equal(decision.decision, "ALLOW");
});

test("RiskEngine returns SOFT_BLOCK with CONTINUE when budget near limit", async () => {
  const config = createPolymarketConfig({
    risk: {
      enforcementMode: "warn-only",
      maxNotionalUsdPerOrder: 1000,
      maxNotionalUsdPerMarketPerDay: 100,
      maxNotionalUsdPerSkillPerDay: 100,
    },
  });

  const risk = new RiskEngine({ config, clobService: mockClob() });
  risk.recordFilledIntent("s1", "m1", 79);

  const decision = await risk.evaluate(
    { tokenId: "m1", conditionId: "m1", size: 20, limitPrice: 0.5, side: "BUY" },
    { skillId: "s1" },
  );

  assert.equal(decision.decision, "SOFT_BLOCK");
  assert.equal(decision.effectiveAction, "CONTINUE");
  assert.ok(decision.reasonCodes.includes("SKILL_BUDGET_NEAR_LIMIT"));
  assert.ok(decision.reasonCodes.includes("MARKET_BUDGET_NEAR_LIMIT"));
});
