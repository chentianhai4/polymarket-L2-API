import test from "node:test";
import assert from "node:assert/strict";
import { buildPolymarketMcpTools } from "../src/openclaw/polymarket/mcp/tools.mjs";
import { classifyMcpError, McpErrorCode } from "../src/openclaw/polymarket/mcp/errorCodes.mjs";
import { AuthError, PolymarketError, RiskBlockedError, ValidationError } from "../src/openclaw/polymarket/errors.mjs";

function getTool(tools, name) {
  const tool = tools.find((x) => x.name === name);
  assert.ok(tool, `tool not found: ${name}`);
  return tool;
}

function buildGatewayMock() {
  return {
    initializeCalls: 0,
    async initialize() {
      this.initializeCalls += 1;
      return { signer: "0xabc", chainId: 137 };
    },
    credentials: {
      async validateCurrentCreds() {
        return true;
      },
      async validateOrRecover() {
        return { key: "k", secret: "s", passphrase: "p" };
      },
    },
    clob: {
      getApiCreds() {
        return { key: "k", secret: "s", passphrase: "p" };
      },
      async updateBalanceAllowance() {
        return { ok: true };
      },
      async getBalanceAllowance() {
        return { balance: "1000000", allowances: { default: "1" } };
      },
    },
    async discoverMarkets() {
      return [];
    },
    async getQuote() {
      return { price: { price: "0.50" } };
    },
    async precheckOrder() {
      return {
        intent: { tokenId: "1", size: 10, limitPrice: 0.5 },
        riskDecision: {
          decision: "SOFT_BLOCK",
          effectiveAction: "CONTINUE",
          reasonCodes: ["FEE_RATE_UNAVAILABLE"],
          requiredActions: ["Retry"],
        },
      };
    },
    async placeOrder() {
      return {
        accepted: true,
        orderIds: ["oid-1"],
        tradeIds: [],
        finalStatus: "SUBMITTED",
        warnings: ["FEE_RATE_UNAVAILABLE"],
      };
    },
    async batchPlaceOrders() {
      return { ok: true };
    },
    async cancel() {
      return { canceled: true };
    },
    async syncOrders() {
      return [];
    },
    async syncTrades() {
      return { clobTrades: [], dataApiTrades: [] };
    },
    async syncPositions() {
      return { positions: [] };
    },
    async getMarketDataBatch(args) {
      return { tokenIds: args.tokenIds ?? [], warnings: [] };
    },
    async getTradeMeta(args) {
      return { action: args.action, ok: true };
    },
    async bridgeFunds(action, payload) {
      return { action, payload, ok: true };
    },
    async getProfileAggregate(args) {
      return { address: args.address, warnings: [] };
    },
    async getLeaderboard() {
      return [{ rank: 1 }];
    },
    async getBuilderAnalytics() {
      return { leaderboard: [], volume: [], warnings: [] };
    },
    async getEvents(args) {
      return { action: args.action ?? "list" };
    },
    async getTags(args) {
      return { action: args.action ?? "list" };
    },
    async getSeries(args) {
      return { action: args.action ?? "list" };
    },
    async getComments(args) {
      return { action: args.action ?? "list" };
    },
    async getSportsMeta(args) {
      return { action: args.action ?? "sports" };
    },
    metricsSnapshot() {
      return { counters: {} };
    },
  };
}

test("pm_order_place validates signal/intent input", async () => {
  const gateway = buildGatewayMock();
  const tools = buildPolymarketMcpTools({ gateway });
  const tool = getTool(tools, "pm_order_place");

  await assert.rejects(async () => {
    await tool.execute({ context: {} });
  }, ValidationError);
});

test("pm_precheck_order returns warn-only decision and warnings", async () => {
  const gateway = buildGatewayMock();
  const tools = buildPolymarketMcpTools({ gateway });
  const tool = getTool(tools, "pm_precheck_order");

  const result = await tool.execute({
    intent: { tokenId: "1", side: "BUY", orderType: "LIMIT", size: 10, limitPrice: 0.5 },
    context: { countryCode: "SG" },
  });

  assert.equal(result.data.riskDecision.decision, "SOFT_BLOCK");
  assert.equal(result.data.riskDecision.effectiveAction, "CONTINUE");
  assert.deepEqual(result.warnings, ["FEE_RATE_UNAVAILABLE"]);
});

test("pm_order_place surfaces ORDER_SUBMISSION_UNCONFIRMED as actionable risk error", async () => {
  const gateway = buildGatewayMock();
  gateway.placeOrder = async () => {
    throw new RiskBlockedError("Order submission could not be confirmed", {
      errorCode: "ORDER_SUBMISSION_UNCONFIRMED",
      submissionDiagnostics: {
        initialPayload: "",
        confirmAttempts: [{ attempt: 1, openOrders: [], trades: [] }],
      },
    });
  };

  const tools = buildPolymarketMcpTools({ gateway });
  const tool = getTool(tools, "pm_order_place");

  await assert.rejects(async () => {
    await tool.execute({
      intent: { tokenId: "1", side: "BUY", orderType: "LIMIT", size: 5, limitPrice: 0.5 },
      context: { countryCode: "SG" },
    });
  }, (error) => {
    assert.equal(error instanceof RiskBlockedError, true);
    assert.equal(classifyMcpError(error), McpErrorCode.ORDER_SUBMISSION_UNCONFIRMED);
    assert.equal(error.details?.errorCode, "ORDER_SUBMISSION_UNCONFIRMED");
    return true;
  });
});

test("pm_trade_meta_get supports action dispatch", async () => {
  const gateway = buildGatewayMock();
  const tools = buildPolymarketMcpTools({ gateway });
  const tool = getTool(tools, "pm_trade_meta_get");

  const result = await tool.execute({ action: "server_time" });
  assert.equal(result.data.action, "server_time");
  assert.equal(result.data.result.ok, true);
});

test("pm_bridge_deposit_create blocks non-dry-run when bridge writes disabled", async () => {
  const previous = process.env.PM_MCP_ENABLE_BRIDGE_WRITES;
  delete process.env.PM_MCP_ENABLE_BRIDGE_WRITES;
  try {
    const gateway = buildGatewayMock();
    const tools = buildPolymarketMcpTools({ gateway });
    const tool = getTool(tools, "pm_bridge_deposit_create");
    await assert.rejects(async () => {
      await tool.execute({ payload: { amount: "1" }, dryRun: false });
    }, ValidationError);
  } finally {
    if (previous === undefined) {
      delete process.env.PM_MCP_ENABLE_BRIDGE_WRITES;
    } else {
      process.env.PM_MCP_ENABLE_BRIDGE_WRITES = previous;
    }
  }
});

test("pm_bridge_deposit_create returns preview in dryRun mode", async () => {
  const gateway = buildGatewayMock();
  const tools = buildPolymarketMcpTools({ gateway });
  const tool = getTool(tools, "pm_bridge_deposit_create");

  const result = await tool.execute({ payload: { amount: "1" }, dryRun: true });
  assert.equal(result.data.dryRun, true);
  assert.equal(result.data.preview.action, "deposit");
});

test("pm_profile_get aggregates profile data", async () => {
  const gateway = buildGatewayMock();
  const tools = buildPolymarketMcpTools({ gateway });
  const tool = getTool(tools, "pm_profile_get");

  const result = await tool.execute({ address: "0xabc" });
  assert.equal(result.data.address, "0xabc");
});

test("classifyMcpError maps known error families", () => {
  assert.equal(classifyMcpError(new ValidationError("bad input")), McpErrorCode.VALIDATION_FAILED);
  assert.equal(classifyMcpError(new AuthError("invalid key")), McpErrorCode.AUTH_INVALID_KEY);
  assert.equal(
    classifyMcpError(new PolymarketError("rate", { status: 429 })),
    McpErrorCode.RATE_LIMITED,
  );
  assert.equal(
    classifyMcpError(new PolymarketError("upstream down", { status: 503 })),
    McpErrorCode.UPSTREAM_UNAVAILABLE,
  );
  assert.equal(
    classifyMcpError(new RiskBlockedError("unconfirmed", { errorCode: "ORDER_SUBMISSION_UNCONFIRMED" })),
    McpErrorCode.ORDER_SUBMISSION_UNCONFIRMED,
  );
});
