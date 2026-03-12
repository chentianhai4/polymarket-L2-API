#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../src/openclaw/polymarket/env.mjs";
import { PolymarketGateway } from "../src/openclaw/polymarket/polymarketGateway.mjs";
import { buildPolymarketMcpTools } from "../src/openclaw/polymarket/mcp/tools.mjs";
import { TOOL_ORDER, buildDefaultArgsByTool } from "../src/openclaw/polymarket/ui/toolCatalog.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const REPORT_PATH = path.join(ROOT_DIR, "MCP_TOOL_VALIDATION.md");
const TIMEOUT_MS = Math.max(1000, Number(process.env.MCP_VALIDATE_TIMEOUT_MS ?? 30000));

const REQUIRED_ENV = [
  "POLYMARKET_PROXY_URL",
  "PRIVATE_KEY",
  "API_KEY",
  "SECRET",
  "PASSPHRASE",
  "FUNDER_ADDRESS",
];

function nowIsoLocal() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

function fail(message) {
  console.error(`[mcp:validate] ${message}`);
  process.exit(1);
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timeout after ${timeoutMs}ms (${label})`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function shortenString(value, max = 260) {
  const text = String(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...<trimmed>`;
}

function compact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return shortenString(value, 320);
  if (typeof value !== "object") return value;
  if (depth >= 4) return "<trimmed>";

  if (Array.isArray(value)) {
    const limit = 5;
    const items = value.slice(0, limit).map((item) => compact(item, depth + 1));
    if (value.length > limit) items.push(`... +${value.length - limit} more`);
    return items;
  }

  const output = {};
  const entries = Object.entries(value);
  const limit = 20;
  for (const [key, val] of entries.slice(0, limit)) {
    output[key] = compact(val, depth + 1);
  }
  if (entries.length > limit) {
    output.__trimmed__ = `+${entries.length - limit} keys`;
  }
  return output;
}

function parseJsonMaybe(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function extractTokenIdsFromMarket(market) {
  const fromDirect = market?.clobTokenIds ?? market?.clob_token_ids ?? market?.outcomeTokenIds ?? [];
  if (Array.isArray(fromDirect) && fromDirect.length > 0) {
    return fromDirect.map((x) => String(x));
  }

  const fromText = parseJsonMaybe(fromDirect);
  if (fromText.length > 0) {
    return fromText.map((x) => String(x));
  }

  if (Array.isArray(market?.tokens)) {
    return market.tokens
      .map((token) => token?.id ?? token?.tokenId ?? token?.token_id ?? token?.asset ?? token?.asset_id)
      .filter(Boolean)
      .map((x) => String(x));
  }

  return [];
}

function extractTokenIdFromPositions(positions = []) {
  if (!Array.isArray(positions)) return null;
  for (const item of positions) {
    const token =
      item?.asset ??
      item?.asset_id ??
      item?.tokenId ??
      item?.token_id ??
      item?.outcomeTokenId ??
      item?.outcome_token_id;
    if (token) return String(token);
  }
  return null;
}

function buildIntent({ tokenId, conditionId }) {
  return {
    tokenId: String(tokenId),
    conditionId: conditionId ? String(conditionId) : undefined,
    side: "BUY",
    orderType: "LIMIT",
    size: 1,
    limitPrice: 0.5,
    timeInForce: "GTC",
    postOnly: true,
  };
}

function classifyFailure(error) {
  const message = String(error?.message ?? error);
  if (message.toLowerCase().includes("timeout")) return "UNKNOWN";
  return "ERR";
}

async function main() {
  const dotenvPath = process.env.POLYMARKET_ENV_PATH
    ? path.resolve(process.env.POLYMARKET_ENV_PATH)
    : path.join(ROOT_DIR, ".env");
  loadDotEnv(dotenvPath);

  process.env.POLYMARKET_REQUEST_TIMEOUT_MS = String(TIMEOUT_MS);

  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    fail(`Missing required env vars: ${missing.join(", ")} (dotenv: ${dotenvPath})`);
  }

  const gateway = new PolymarketGateway({
    dotenvPath,
    config: {
      requestTimeoutMs: TIMEOUT_MS,
    },
  });

  const tools = buildPolymarketMcpTools({ gateway });
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  for (const name of TOOL_ORDER) {
    if (!toolMap.has(name)) {
      fail(`Tool not found: ${name}`);
    }
  }

  const details = [];
  const argsByTool = {};

  async function callTool(name, args) {
    const tool = toolMap.get(name);
    const startedAt = Date.now();
    try {
      const payload = await withTimeout(tool.execute(args), TIMEOUT_MS, name);
      const elapsedMs = Date.now() - startedAt;
      return {
        tool: name,
        args,
        status: "OK",
        elapsedMs,
        response: payload,
      };
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      return {
        tool: name,
        args,
        status: classifyFailure(error),
        elapsedMs,
        error: {
          name: error?.name ?? "Error",
          message: error?.message ?? String(error),
          details: compact(error?.details),
        },
      };
    }
  }

  const bootstrapArgs = { autoAuth: true };
  argsByTool.pm_auth_bootstrap = bootstrapArgs;
  const bootstrap = await callTool("pm_auth_bootstrap", bootstrapArgs);
  details.push(bootstrap);
  const signerAddress = bootstrap.response?.data?.signer ?? null;

  const validateArgs = { recover: true };
  argsByTool.pm_auth_validate = validateArgs;
  details.push(await callTool("pm_auth_validate", validateArgs));

  const discoverArgs = { limit: 10, active: true };
  argsByTool.pm_market_discover = discoverArgs;
  const discovered = await callTool("pm_market_discover", discoverArgs);
  details.push(discovered);
  const discoveredMarkets = discovered.response?.data?.markets ?? [];

  let tokenId = null;
  let conditionId = null;
  if (signerAddress) {
    const preSync = await callTool("pm_sync_positions", {
      params: { address: signerAddress },
    });
    if (preSync.status === "OK") {
      tokenId = extractTokenIdFromPositions(preSync.response?.data?.positions);
      conditionId =
        preSync.response?.data?.positions?.[0]?.conditionId ??
        preSync.response?.data?.positions?.[0]?.condition_id ??
        null;
    }
  }

  if (!tokenId) {
    for (const market of discoveredMarkets) {
      const ids = extractTokenIdsFromMarket(market);
      if (ids.length > 0) {
        tokenId = ids[0];
        conditionId = market?.conditionId ?? market?.condition_id ?? null;
        break;
      }
    }
  }

  if (!tokenId) {
    fail("Unable to resolve tokenId from positions or discovered markets");
  }

  const defaultArgs = buildDefaultArgsByTool({
    tokenId,
    conditionId,
    address: signerAddress ?? process.env.FUNDER_ADDRESS,
  });

  const alreadyCalled = new Set(["pm_auth_bootstrap", "pm_auth_validate", "pm_market_discover"]);
  for (const name of TOOL_ORDER) {
    if (alreadyCalled.has(name)) continue;
    const args = defaultArgs[name] ?? {};
    argsByTool[name] = args;
    details.push(await callTool(name, args));
  }

  const lines = [];
  lines.push("# Polymarket MCP 工具调用验证报告");
  lines.push("");
  lines.push(`- 时间: ${nowIsoLocal()}`);
  lines.push(`- 目录: \`${ROOT_DIR}\``);
  lines.push(`- 执行方式: 直接调用 MCP tool execute（无真实交易）`);
  lines.push(`- 超时配置: ${TIMEOUT_MS}ms（工具调用 + HTTP 请求）`);
  lines.push(`- 代理要求: POLYMARKET_PROXY_URL 已启用（fail-fast）`);
  lines.push("");
  lines.push("注意：交易/撤单相关工具本次统一使用 `dryRun=true`，仅做参数校验与预执行检查，不会触发真实下单/撤单。");
  lines.push("");
  lines.push("## 汇总");
  lines.push("");

  for (const item of details) {
    lines.push(`- \`${item.tool}\` args=${JSON.stringify(item.args)} => **${item.status}** (${item.elapsedMs}ms)`);
  }

  const summary = details.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    },
    { OK: 0, ERR: 0, UNKNOWN: 0 },
  );

  lines.push("");
  lines.push(`- 统计: OK=${summary.OK ?? 0}, ERR=${summary.ERR ?? 0}, UNKNOWN=${summary.UNKNOWN ?? 0}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 逐项结果");
  lines.push("");

  for (const item of details) {
    lines.push(`### ${item.tool} — ${item.status}`);
    lines.push("");
    lines.push(`Args: \`${JSON.stringify(item.args)}\``);
    lines.push("");
    if (item.status === "OK") {
      lines.push("Response:");
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(compact(item.response), null, 2));
      lines.push("```");
    } else {
      lines.push("Error:");
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(compact(item.error), null, 2));
      lines.push("```");
    }
    lines.push("");
  }

  fs.writeFileSync(REPORT_PATH, `${lines.join("\n")}\n`, "utf8");
  console.log(`[mcp:validate] report updated: ${REPORT_PATH}`);

  if ((summary.ERR ?? 0) > 0 || (summary.UNKNOWN ?? 0) > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  fail(error?.message ?? String(error));
});
