import test from "node:test";
import assert from "node:assert/strict";
import { createUiServer } from "../src/openclaw/polymarket/ui/server.mjs";
import { TOOL_ORDER } from "../src/openclaw/polymarket/ui/toolCatalog.mjs";

function buildGatewayMock() {
  return {
    initCalls: 0,
    clob: {
      funderAddress: "0xFunder000000000000000000000000000000000001",
      async getSignerAddress() {
        return "0xSigner000000000000000000000000000000000001";
      },
    },
    async initialize() {
      this.initCalls += 1;
      return { signer: "0xSigner000000000000000000000000000000000001", chainId: 137 };
    },
  };
}

function buildTools(capture = new Map()) {
  return TOOL_ORDER.map((name) => ({
    name,
    description: `tool ${name}`,
    async execute(args = {}) {
      capture.set(name, args);
      if (name === "pm_sync_positions") {
        return {
          data: {
            positions: [
              {
                asset: "123456789",
                conditionId: "0xabc",
              },
            ],
          },
        };
      }

      if (name === "pm_market_discover") {
        return {
          data: {
            markets: [
              {
                conditionId: "0xdef",
                clobTokenIds: ["111", "222"],
              },
            ],
          },
        };
      }

      return {
        data: {
          echo: args,
        },
      };
    },
  }));
}

async function startServer({ allowLiveActions = false, capture = new Map() } = {}) {
  const gateway = buildGatewayMock();
  const tools = buildTools(capture);
  const app = createUiServer({
    host: "127.0.0.1",
    port: 0,
    allowLiveActions,
    gateway,
    tools,
    toolTimeoutMs: 5000,
  });
  const started = await app.start();
  return {
    app,
    baseUrl: `http://127.0.0.1:${started.port}`,
    capture,
  };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return await res.json();
}

test("ui server returns VALIDATION_FAILED for unknown tool", async () => {
  const { app, baseUrl } = await startServer();
  try {
    const payload = await postJson(`${baseUrl}/api/tools/not_exists/run`, { args: {} });
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, "VALIDATION_FAILED");
  } finally {
    await app.stop();
  }
});

test("trade tool injects dryRun=true by default", async () => {
  const capture = new Map();
  const { app, baseUrl } = await startServer({ capture, allowLiveActions: false });
  try {
    const payload = await postJson(`${baseUrl}/api/tools/pm_order_place/run`, {
      args: { intent: { tokenId: "1" } },
      allowLive: false,
    });
    assert.equal(payload.ok, true);
    const args = capture.get("pm_order_place");
    assert.equal(args.dryRun, true);
  } finally {
    await app.stop();
  }
});

test("trade tool keeps caller args when live mode is enabled", async () => {
  const capture = new Map();
  const { app, baseUrl } = await startServer({ capture, allowLiveActions: true });
  try {
    const payload = await postJson(`${baseUrl}/api/tools/pm_order_place/run`, {
      args: { intent: { tokenId: "1" } },
      allowLive: true,
    });
    assert.equal(payload.ok, true);
    const args = capture.get("pm_order_place");
    assert.equal("dryRun" in args, false);
  } finally {
    await app.stop();
  }
});

test("run-all returns TOOL_ORDER-sized results with trace ids", async () => {
  const { app, baseUrl } = await startServer();
  try {
    const payload = await postJson(`${baseUrl}/api/tools/run-all`, {
      allowLive: false,
      argsByTool: {},
    });
    assert.equal(payload.ok, true);
    assert.equal(payload.data.total, TOOL_ORDER.length);
    assert.equal(payload.data.results.length, TOOL_ORDER.length);
    for (const item of payload.data.results) {
      assert.ok(item.envelope.traceId);
    }
  } finally {
    await app.stop();
  }
});

test("integration flow precheck -> place(dryRun) -> cancel(dryRun) is callable", async () => {
  const { app, baseUrl } = await startServer();
  try {
    const toolsPayload = await fetch(`${baseUrl}/api/tools`).then((res) => res.json());
    const byName = Object.fromEntries(
      (toolsPayload?.data?.tools ?? []).map((tool) => [tool.name, tool.defaultArgs ?? {}]),
    );

    const precheck = await postJson(`${baseUrl}/api/tools/pm_precheck_order/run`, {
      args: byName.pm_precheck_order,
      allowLive: false,
    });
    assert.equal(precheck.ok, true);

    const place = await postJson(`${baseUrl}/api/tools/pm_order_place/run`, {
      args: byName.pm_order_place,
      allowLive: false,
    });
    assert.equal(place.ok, true);
    assert.equal(place.data.args.dryRun, true);

    const cancel = await postJson(`${baseUrl}/api/tools/pm_order_cancel/run`, {
      args: byName.pm_order_cancel,
      allowLive: false,
    });
    assert.equal(cancel.ok, true);
    assert.equal(cancel.data.args.dryRun, true);
  } finally {
    await app.stop();
  }
});
