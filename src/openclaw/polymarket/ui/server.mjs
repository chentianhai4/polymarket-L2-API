import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PolymarketGateway } from "../polymarketGateway.mjs";
import { ValidationError } from "../errors.mjs";
import { buildPolymarketMcpTools } from "../mcp/tools.mjs";
import { createTraceId, toMcpErr, toMcpOk } from "../mcp/envelope.mjs";
import {
  TOOL_ORDER,
  TRADE_TOOL_SET,
  buildDefaultArgsByTool,
  resolveTokenFromMarkets,
  resolveTokenFromPositions,
} from "./toolCatalog.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../../..");
const PUBLIC_DIR = path.join(__dirname, "public");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const ENV_KEYS = [
  "PRIVATE_KEY",
  "API_KEY",
  "SECRET",
  "PASSPHRASE",
  "FUNDER_ADDRESS",
  "SIGNATURE_TYPE",
  "POLYMARKET_PROXY_URL",
  "POLYMARKET_REQUEST_TIMEOUT_MS",
  "PM_UI_ENABLE_LIVE_ACTIONS",
  "UI_HOST",
  "UI_PORT",
];

function toNumber(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readDotEnvMap(dotenvPath) {
  if (!existsSync(dotenvPath)) return {};
  const text = readFileSync(dotenvPath, "utf8");
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    if (value.startsWith("\"") && value.endsWith("\"")) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

function normalizeJsonText(text) {
  if (!text) return {};
  return JSON.parse(text);
}

function isTimeoutError(error) {
  return String(error?.message ?? "").toLowerCase().includes("timeout");
}

function timeoutError(timeoutMs, label) {
  return new Error(`Timeout after ${timeoutMs}ms (${label})`);
}

function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

async function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError(timeoutMs, label)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readBodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const data = Buffer.from(chunk);
    size += data.length;
    if (size > 1024 * 1024 * 2) {
      throw new ValidationError("Request body too large");
    }
    chunks.push(data);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  if (!body.trim()) return {};

  try {
    return normalizeJsonText(body);
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
}

function sendJson(res, statusCode, payload) {
  const text = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function toPublicEnv(dotenvPath, dotenvValues) {
  const values = {};
  for (const key of ENV_KEYS) {
    values[key] = process.env[key] || dotenvValues[key] || null;
  }

  return {
    dotenvPath,
    exists: existsSync(dotenvPath),
    values,
  };
}

function applyTradeGuards(toolName, args, { allowLiveActions, allowLive }) {
  if (!TRADE_TOOL_SET.has(toolName)) return args;

  if (allowLiveActions && allowLive === true) {
    return args;
  }

  return {
    ...args,
    dryRun: true,
  };
}

function getSafePath(rawPathname) {
  const pathname = rawPathname === "/" ? "/index.html" : rawPathname;
  const normalized = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  const resolved = path.resolve(PUBLIC_DIR, `.${normalized}`);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    return null;
  }
  return resolved;
}

export function createUiServer(options = {}) {
  const host = options.host ?? process.env.UI_HOST ?? "127.0.0.1";
  const port = toNumber(options.port ?? process.env.UI_PORT, 17077);
  const toolTimeoutMs = toNumber(options.toolTimeoutMs ?? process.env.UI_TOOL_TIMEOUT_MS, 30000);
  const proxyUrl =
    process.env.POLYMARKET_PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    "http://127.0.0.1:10077";
  const allowLiveActions = Boolean(
    options.allowLiveActions ?? process.env.PM_UI_ENABLE_LIVE_ACTIONS === "1",
  );
  const dotenvPath = process.env.POLYMARKET_ENV_PATH
    ? path.resolve(process.env.POLYMARKET_ENV_PATH)
    : path.join(ROOT_DIR, ".env");
  const dotenvValues = readDotEnvMap(dotenvPath);

  const readEnv = (key) => {
    const fromProcess = process.env[key];
    if (typeof fromProcess === "string" && fromProcess.trim()) return fromProcess;
    const fromDotEnv = dotenvValues[key];
    if (typeof fromDotEnv === "string" && fromDotEnv.trim()) return fromDotEnv;
    return undefined;
  };

  const resolvedProxyUrl =
    proxyUrl ||
    readEnv("POLYMARKET_PROXY_URL") ||
    readEnv("HTTPS_PROXY") ||
    readEnv("HTTP_PROXY") ||
    "http://127.0.0.1:10077";
  const resolvedPrivateKey = options.privateKey ?? readEnv("PRIVATE_KEY");
  const resolvedApiKey = options.apiKey ?? readEnv("API_KEY");
  const resolvedSecret = options.secret ?? readEnv("SECRET");
  const resolvedPassphrase = options.passphrase ?? readEnv("PASSPHRASE");
  const resolvedFunderAddress = options.funderAddress ?? readEnv("FUNDER_ADDRESS");
  const resolvedSignatureType = toNumber(options.signatureType ?? readEnv("SIGNATURE_TYPE"), 2);

  const gateway =
    options.gateway ??
    new PolymarketGateway({
      dotenvPath,
      privateKey: resolvedPrivateKey,
      apiKey: resolvedApiKey,
      secret: resolvedSecret,
      passphrase: resolvedPassphrase,
      funderAddress: resolvedFunderAddress,
      signatureType: resolvedSignatureType,
      config: {
        proxyUrl: resolvedProxyUrl,
        requestTimeoutMs: toNumber(process.env.POLYMARKET_REQUEST_TIMEOUT_MS, 30000),
      },
    });

  const tools = options.tools ?? buildPolymarketMcpTools({ gateway });
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  let initialized = false;

  async function ensureInitialized() {
    if (initialized) return;
    await gateway.initialize({ autoAuth: true });
    initialized = true;
  }

  async function resolveTradingContext() {
    await ensureInitialized();
    const signerAddress = await gateway.clob.getSignerAddress().catch(() => null);
    const funderAddress = gateway.clob.funderAddress ?? process.env.FUNDER_ADDRESS ?? signerAddress ?? null;
    const address = funderAddress ?? signerAddress ?? "0x0000000000000000000000000000000000000000";

    let tokenInfo = null;
    try {
      const syncPositionsTool = toolMap.get("pm_sync_positions");
      if (syncPositionsTool) {
        const res = await withTimeout(
          syncPositionsTool.execute({
            params: {
              address,
              includeOpenOrders: false,
              includeClobTrades: false,
              includeNotifications: false,
            },
          }),
          toolTimeoutMs,
          "resolveToken.syncPositions",
        );
        tokenInfo = resolveTokenFromPositions(res?.data?.positions);
      }
    } catch {
      tokenInfo = null;
    }

    if (!tokenInfo) {
      try {
        const discoverTool = toolMap.get("pm_market_discover");
        if (discoverTool) {
          const res = await withTimeout(
            discoverTool.execute({ limit: 10, active: true }),
            toolTimeoutMs,
            "resolveToken.marketDiscover",
          );
          tokenInfo = resolveTokenFromMarkets(res?.data?.markets);
        }
      } catch {
        tokenInfo = null;
      }
    }

    return {
      signerAddress,
      funderAddress,
      address,
      tokenId: tokenInfo?.tokenId ?? "0",
      conditionId: tokenInfo?.conditionId || "0x0",
    };
  }

  async function executeTool(toolName, rawArgs, allowLive) {
    const tool = toolMap.get(toolName);
    if (!tool) {
      throw new ValidationError(`Unknown tool: ${toolName}`);
    }

    const finalArgs = applyTradeGuards(toolName, rawArgs ?? {}, {
      allowLiveActions,
      allowLive,
    });

    const startedAt = Date.now();
    const traceId = createTraceId();
    try {
      await ensureInitialized();
      const result = await withTimeout(tool.execute(finalArgs), toolTimeoutMs, toolName);
      const elapsedMs = Date.now() - startedAt;
      const ok = toMcpOk(
        {
          tool: toolName,
          args: finalArgs,
          result: result?.data ?? result,
          elapsedMs,
        },
        { traceId, warnings: result?.warnings ?? [] },
      );
      return { status: "OK", envelope: ok };
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const err = toMcpErr(error, { traceId });
      const status = isTimeoutError(error) ? "TIMEOUT" : "ERR";
      err.meta = {
        tool: toolName,
        args: finalArgs,
        elapsedMs,
      };
      return { status, envelope: err };
    }
  }

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const pathname = reqUrl.pathname;

    try {
      if (req.method === "GET" && pathname === "/api/health") {
        const payload = toMcpOk({
          status: "ok",
          initialized,
          mode: allowLiveActions ? "LIVE_ENABLED" : "SAFE_DRY_RUN",
          host,
          port,
          toolTimeoutMs,
          totalTools: TOOL_ORDER.length,
        });
        sendJson(res, 200, payload);
        return;
      }

      if (req.method === "GET" && pathname === "/api/env") {
        const payload = toMcpOk({
          mode: allowLiveActions ? "LIVE_ENABLED" : "SAFE_DRY_RUN",
          env: toPublicEnv(dotenvPath, dotenvValues),
        });
        sendJson(res, 200, payload);
        return;
      }

      if (req.method === "GET" && pathname === "/api/tools") {
        const tradingContext = await resolveTradingContext();
        const defaults = buildDefaultArgsByTool(tradingContext);

        const payload = toMcpOk({
          context: tradingContext,
          tools: TOOL_ORDER.map((name) => ({
            name,
            description: toolMap.get(name)?.description ?? "",
            defaultArgs: defaults[name] ?? {},
            isTradeTool: TRADE_TOOL_SET.has(name),
          })),
        });
        sendJson(res, 200, payload);
        return;
      }

      if (req.method === "POST" && pathname === "/api/tools/run-all") {
        const body = await readBodyJson(req);
        const allowLive = body?.allowLive === true;
        const overrides = body?.argsByTool && typeof body.argsByTool === "object" ? body.argsByTool : {};
        const tradingContext = await resolveTradingContext();
        const defaults = buildDefaultArgsByTool(tradingContext);

        const startedAt = Date.now();
        const results = [];
        for (const toolName of TOOL_ORDER) {
          const args = overrides[toolName] ?? defaults[toolName] ?? {};
          const item = await executeTool(toolName, args, allowLive);
          results.push({
            tool: toolName,
            status: item.status,
            envelope: item.envelope,
          });
        }
        const endedAt = Date.now();

        const okCount = results.filter((x) => x.status === "OK").length;
        const errCount = results.filter((x) => x.status === "ERR").length;
        const timeoutCount = results.filter((x) => x.status === "TIMEOUT").length;

        sendJson(
          res,
          200,
          toMcpOk({
            startedAt,
            endedAt,
            durationMs: endedAt - startedAt,
            total: TOOL_ORDER.length,
            okCount,
            errCount,
            timeoutCount,
            results,
          }),
        );
        return;
      }

      const runToolMatch = pathname.match(/^\/api\/tools\/([^/]+)\/run$/);
      if (req.method === "POST" && runToolMatch) {
        const toolName = decodeURIComponent(runToolMatch[1] ?? "");
        const body = await readBodyJson(req);
        const allowLive = body?.allowLive === true;
        const args = body?.args && typeof body.args === "object" ? body.args : {};
        const result = await executeTool(toolName, args, allowLive);
        sendJson(res, 200, result.envelope);
        return;
      }

      if (req.method === "GET") {
        const filePath = getSafePath(pathname);
        if (!filePath) {
          sendJson(res, 400, toMcpErr(new ValidationError("Invalid static path")));
          return;
        }

        try {
          const content = await fs.readFile(filePath);
          res.writeHead(200, {
            "Content-Type": contentTypeFor(filePath),
            "Content-Length": content.byteLength,
            "Cache-Control": "no-store",
          });
          res.end(content);
          return;
        } catch {
          sendJson(res, 404, toMcpErr(new ValidationError("Not found")));
          return;
        }
      }

      sendJson(res, 404, toMcpErr(new ValidationError("Route not found")));
    } catch (error) {
      sendJson(res, 500, toMcpErr(error));
    }
  });

  return {
    host,
    port,
    server,
    async start() {
      await new Promise((resolve) => {
        server.listen(port, host, () => resolve());
      });
      const address = server.address();
      const effectivePort = typeof address === "object" && address ? address.port : port;
      return { host, port: effectivePort };
    },
    async stop() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function startFromCli() {
  const app = createUiServer();
  const { host, port } = await app.start();
  console.log(`[pm-ui] manual debug ui started at http://${host}:${port}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startFromCli().catch((error) => {
    console.error("[pm-ui] startup failed:", error?.message ?? String(error));
    process.exit(1);
  });
}
