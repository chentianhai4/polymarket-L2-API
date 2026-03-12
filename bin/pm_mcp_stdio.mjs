#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startPolymarketMcpStdio } from "../src/openclaw/polymarket/mcp/server.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const dotenvPath = process.env.POLYMARKET_ENV_PATH
  ? path.resolve(process.env.POLYMARKET_ENV_PATH)
  : path.join(projectRoot, ".env");

startPolymarketMcpStdio({
  gatewayOptions: {
    dotenvPath,
  },
})
  .then(() => {
    console.error(`[pm-mcp] stdio server started (dotenv: ${fs.existsSync(dotenvPath) ? dotenvPath : "not found"})`);
  })
  .catch((error) => {
    console.error("[pm-mcp] startup failed:", error?.message ?? String(error));
    process.exit(1);
  });
