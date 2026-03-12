#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const CALL = path.join(ROOT_DIR, 'scripts', 'pm_mcp_call.sh');

function nowIsoLocal() {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}

function compact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const max = 320;
    return value.length <= max ? value : value.slice(0, max) + '...<trimmed>';
  }
  if (typeof value !== 'object') return value;
  if (depth >= 4) return '<trimmed>';

  if (Array.isArray(value)) {
    const limit = 5;
    const items = value.slice(0, limit).map((x) => compact(x, depth + 1));
    if (value.length > limit) items.push(`... +${value.length - limit} more`);
    return items;
  }

  const out = {};
  const entries = Object.entries(value);
  const limit = 25;
  for (const [k, v] of entries.slice(0, limit)) out[k] = compact(v, depth + 1);
  if (entries.length > limit) out.__trimmed__ = `+${entries.length - limit} keys`;
  return out;
}

function callTool(toolName, argsObj, timeoutMs = 90000) {
  const args = argsObj ? JSON.stringify(argsObj) : '{}';
  const started = Date.now();
  const env = {
    ...process.env,
    // keep mcporter + HTTP timeouts aligned with our per-call timeout
    MCPORTER_CALL_TIMEOUT: String(timeoutMs),
    POLYMARKET_REQUEST_TIMEOUT_MS: String(timeoutMs),
  };
  try {
    const stdout = execFileSync('bash', [CALL, toolName, args], {
      cwd: ROOT_DIR,
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      maxBuffer: 10 * 1024 * 1024,
    }).toString('utf8').trim();
    const elapsedMs = Date.now() - started;
    const parsed = stdout ? JSON.parse(stdout) : null;
    const ok = !!parsed?.ok;
    return { tool: toolName, args: argsObj ?? {}, status: ok ? 'OK' : 'ERR', elapsedMs, response: parsed };
  } catch (e) {
    const elapsedMs = Date.now() - started;
    const stderr = (e?.stderr ? e.stderr.toString('utf8') : '') || '';
    const stdout = (e?.stdout ? e.stdout.toString('utf8') : '') || '';
    return {
      tool: toolName,
      args: argsObj ?? {},
      status: 'ERR',
      elapsedMs,
      error: {
        name: e?.name ?? 'Error',
        message: e?.message ?? String(e),
        stdout: stdout.slice(0, 1200),
        stderr: stderr.slice(0, 1200),
      },
    };
  }
}

function parseJsonMaybe(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function extractTokenAndCondition(discoverResp) {
  const market = discoverResp?.data?.markets?.[0];
  const conditionId = market?.conditionId ?? market?.condition_id ?? null;
  let tokenId = null;
  const raw = market?.clobTokenIds ?? market?.clob_token_ids;
  if (Array.isArray(raw)) tokenId = raw?.[0];
  if (!tokenId && typeof raw === 'string') {
    const parsed = parseJsonMaybe(raw);
    if (Array.isArray(parsed)) tokenId = parsed?.[0];
  }
  return { tokenId: tokenId ? String(tokenId) : null, conditionId: conditionId ? String(conditionId) : null };
}

function buildIntent({ tokenId, conditionId }) {
  return {
    tokenId: String(tokenId),
    conditionId: conditionId ? String(conditionId) : undefined,
    side: 'BUY',
    orderType: 'LIMIT',
    size: 1,
    limitPrice: 0.5,
    timeInForce: 'GTC',
    postOnly: true,
  };
}

const details = [];

// 1) auth bootstrap/validate
const bootstrap = callTool('pm_auth_bootstrap', { autoAuth: true });
details.push(bootstrap);
const signer = bootstrap.response?.data?.signer ?? null;

const validate = callTool('pm_auth_validate', { recover: true });
details.push(validate);

// 2) discover -> tokenId/conditionId
const discover = callTool('pm_market_discover', { limit: 1, active: true });
details.push(discover);
const { tokenId, conditionId } = extractTokenAndCondition(discover.response);
if (!tokenId) {
  details.push({ tool: 'mcp_tool_validate_cli', args: {}, status: 'ERR', elapsedMs: 0, error: { message: 'Unable to resolve tokenId from pm_market_discover' } });
}

const intent = tokenId ? buildIntent({ tokenId, conditionId }) : null;
const context = tokenId
  ? { skillId: 'mcp-validate-cli', countryCode: 'SG', idempotencyKey: `mcp-validate-cli:${tokenId}` }
  : null;

// Remaining tools (all trading-ish dryRun)
if (tokenId) {
  details.push(callTool('pm_quote_get', { tokenId, side: 'BUY' }));
  details.push(callTool('pm_balance_get', { assetType: 'COLLATERAL', updateFirst: false }));
  details.push(callTool('pm_precheck_order', { intent, context }));
  details.push(callTool('pm_order_place', { intent, context, dryRun: true }));
  details.push(callTool('pm_order_batch_place', { intents: [intent], dryRun: true }));
  details.push(callTool('pm_order_cancel', { payload: { all: true }, dryRun: true }));
  details.push(callTool('pm_order_cancel_all', { dryRun: true }));
  details.push(callTool('pm_sync_orders', { params: {} }));
  details.push(callTool('pm_sync_trades', { params: {} }));
  details.push(
    callTool('pm_sync_positions', {
      params: {
        address: signer ?? process.env.FUNDER_ADDRESS,
        includeOpenOrders: false,
        includeClobTrades: false,
        includeNotifications: false,
      },
    }),
  );
}

details.push(callTool('pm_metrics_snapshot', {}));

// Report
const reportPath = path.join(ROOT_DIR, `MCP_TOOL_VALIDATION_${new Date().toISOString().slice(0, 10)}.md`);

const counts = details.reduce(
  (acc, x) => {
    acc[x.status] = (acc[x.status] ?? 0) + 1;
    return acc;
  },
  { OK: 0, ERR: 0 },
);

const lines = [];
lines.push('# Polymarket MCP 工具调用验证报告（CLI）');
lines.push('');
lines.push(`- 时间: ${nowIsoLocal()}`);
lines.push(`- 执行方式: bash pm_mcp_call.sh -> mcporter call --stdio`);
lines.push('- 风险控制: 交易/撤单相关工具均使用 dryRun=true（不会真实下单/撤单）');
lines.push('');
lines.push('## 汇总');
lines.push('');
for (const item of details) {
  lines.push(`- \`${item.tool}\` => **${item.status}** (${item.elapsedMs}ms) args=\`${JSON.stringify(item.args)}\``);
}
lines.push('');
lines.push(`- 统计: OK=${counts.OK ?? 0}, ERR=${counts.ERR ?? 0}`);
lines.push('');
lines.push('---');
lines.push('');
lines.push('## 逐项结果（响应已做裁剪）');
lines.push('');

for (const item of details) {
  lines.push(`### ${item.tool} — ${item.status}`);
  lines.push('');
  lines.push(`Args: \`${JSON.stringify(item.args)}\``);
  lines.push('');
  if (item.status === 'OK') {
    lines.push('Response:');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(compact(item.response), null, 2));
    lines.push('```');
  } else {
    lines.push('Error:');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(compact(item.error ?? {}), null, 2));
    lines.push('```');
  }
  lines.push('');
}

fs.writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8');
console.log(`[mcp:validate-cli] report written: ${reportPath}`);

if ((counts.ERR ?? 0) > 0) process.exitCode = 2;
