const state = {
  tools: [],
  history: [],
  env: null,
  health: null,
};

const TOOL_PURPOSES = {
  pm_auth_bootstrap: "初始化网关并创建/恢复 L2 凭证。",
  pm_auth_validate: "检查当前 L2 凭证是否有效并可自动恢复。",
  pm_market_discover: "从 Gamma 拉取可交易市场列表。",
  pm_quote_get: "查询 token 的价格、盘口与相关报价信息。",
  pm_market_data_batch_get: "批量查询多个 token 的价格/中间价/点差/订单簿。",
  pm_trade_meta_get: "查询交易元数据（服务器时间、order scoring、heartbeat、last trade、历史价格）。",
  pm_balance_get: "查询 collateral/conditional 余额与 allowance。",
  pm_bridge_supported_assets_get: "查询 Bridge 支持的资产列表。",
  pm_bridge_quote_get: "查询 Bridge 报价。",
  pm_bridge_status_get: "查询 Bridge 地址交易状态。",
  pm_bridge_deposit_create: "创建 Bridge 充值地址（默认 dryRun）。",
  pm_bridge_withdraw_create: "创建 Bridge 提现地址（默认 dryRun）。",
  pm_precheck_order: "仅做下单前风控与参数校验，不实际下单。",
  pm_order_place: "提交单笔订单（默认 dryRun）。",
  pm_order_batch_place: "批量提交订单（默认 dryRun）。",
  pm_order_cancel: "按条件撤单（默认 dryRun）。",
  pm_order_cancel_all: "撤销全部挂单（默认 dryRun）。",
  pm_sync_orders: "同步当前账户未成交订单。",
  pm_sync_trades: "同步 CLOB 与 Data API 成交记录。",
  pm_sync_positions: "同步仓位、活动与账户价值。",
  pm_profile_get: "聚合查询用户资料、仓位、活动、价值与历史持仓数据。",
  pm_leaderboard_get: "查询交易排行榜。",
  pm_builder_analytics_get: "查询 Builder 排行与日成交量。",
  pm_events_get: "按 action 查询 Events 数据。",
  pm_tags_get: "按 action 查询 Tags 与关联关系。",
  pm_series_get: "按 action 查询 Series。",
  pm_comments_get: "按 action 查询 Comments。",
  pm_sports_meta_get: "按 action 查询 Sports 元数据/类型/球队。",
  pm_ws_subscribe: "创建 WebSocket 会话订阅（market/user/sports）。",
  pm_ws_poll: "轮询 WebSocket 会话消息。",
  pm_ws_unsubscribe: "关闭 WebSocket 会话。",
  pm_metrics_snapshot: "读取当前服务内存指标快照。",
};

const els = {
  statusBar: document.querySelector("#statusBar"),
  envView: document.querySelector("#envView"),
  toolsContainer: document.querySelector("#toolsContainer"),
  responseView: document.querySelector("#responseView"),
  historyList: document.querySelector("#historyList"),
  refreshBtn: document.querySelector("#refreshBtn"),
  runAllBtn: document.querySelector("#runAllBtn"),
  allowLiveToggle: document.querySelector("#allowLiveToggle"),
  summaryBar: document.querySelector("#summaryBar"),
};

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function nowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

function pushHistory(item) {
  state.history.unshift(item);
  if (state.history.length > 80) {
    state.history.length = 80;
  }
  renderHistory();
}

function getAllowLive() {
  return els.allowLiveToggle.checked;
}

function renderStatus() {
  const mode = state.health?.data?.mode ?? "UNKNOWN";
  const host = state.health?.data?.host ?? "-";
  const port = state.health?.data?.port ?? "-";
  const tools = state.tools.length;
  els.statusBar.textContent = `模式=${mode} | 地址=http://${host}:${port} | 工具数=${tools} | 时间=${nowText()}`;
}

function renderEnv() {
  els.envView.textContent = formatJson(state.env ?? { message: "无环境数据" });
}

function updateResponse(payload) {
  els.responseView.textContent = formatJson(payload);
}

function renderHistory() {
  if (state.history.length === 0) {
    els.historyList.innerHTML = "<div class='history-item'>暂无历史</div>";
    return;
  }

  const html = state.history
    .map((item) => {
      const badgeClass = item.status === "OK" ? "ok" : item.status === "TIMEOUT" ? "timeout" : "err";
      return `
        <div class="history-item">
          <div class="meta">
            <span class="badge ${badgeClass}">${item.status}</span>
            <strong>${item.tool}</strong>
            <span> | ${item.time}</span>
          </div>
          <pre class="json-box">${escapeHtml(formatJson(item.payload))}</pre>
        </div>
      `;
    })
    .join("");
  els.historyList.innerHTML = html;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderTools() {
  const html = state.tools
    .map((tool) => {
      const defaultArgs = formatJson(tool.defaultArgs ?? {});
      const tradeBadge = tool.isTradeTool ? "<span class='badge trade'>TRADE</span>" : "";
      const purpose = TOOL_PURPOSES[tool.name] ?? tool.description ?? "无";
      return `
        <article class="tool-card" data-tool="${tool.name}">
          <div class="tool-header">
            <h3 class="tool-title">${tool.name}</h3>
            <div>${tradeBadge}</div>
          </div>
          <p class="tool-desc">${tool.description ?? ""}</p>
          <textarea data-role="args">${escapeHtml(defaultArgs)}</textarea>
          <div class="actions">
            <button type="button" data-role="run">执行</button>
            <span class="tool-purpose">作用：${escapeHtml(purpose)}</span>
          </div>
        </article>
      `;
    })
    .join("");

  els.toolsContainer.innerHTML = html;
  for (const card of els.toolsContainer.querySelectorAll(".tool-card")) {
    const runBtn = card.querySelector("button[data-role='run']");
    runBtn.addEventListener("click", () => runSingleTool(card));
  }
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });
  const payload = await res.json();
  return payload;
}

async function refreshBaseData() {
  const [health, envPayload, toolsPayload] = await Promise.all([
    requestJson("/api/health"),
    requestJson("/api/env"),
    requestJson("/api/tools"),
  ]);

  state.health = health;
  state.env = envPayload;
  state.tools = toolsPayload?.data?.tools ?? [];
  renderStatus();
  renderEnv();
  renderTools();
  updateResponse({ health, env: envPayload, tools: toolsPayload });
}

function parseArgsFromCard(card) {
  const area = card.querySelector("textarea[data-role='args']");
  const raw = area.value.trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`JSON 解析失败: ${error.message}`);
  }
}

async function runSingleTool(card) {
  const tool = card.dataset.tool;
  let args = {};
  try {
    args = parseArgsFromCard(card);
  } catch (error) {
    updateResponse({ tool, status: "ERR", error: error.message });
    return;
  }

  const payload = await requestJson(`/api/tools/${encodeURIComponent(tool)}/run`, {
    method: "POST",
    body: JSON.stringify({
      args,
      allowLive: getAllowLive(),
    }),
  });

  updateResponse(payload);
  pushHistory({
    tool,
    status: payload.ok ? "OK" : "ERR",
    payload,
    time: nowText(),
  });
}

function renderRunAllSummary(payload) {
  const data = payload?.data ?? {};
  els.summaryBar.textContent = `Run All: total=${data.total ?? 0}, ok=${data.okCount ?? 0}, err=${data.errCount ?? 0}, timeout=${data.timeoutCount ?? 0}, durationMs=${data.durationMs ?? 0}`;
}

async function runAllTools() {
  const argsByTool = {};
  for (const card of els.toolsContainer.querySelectorAll(".tool-card")) {
    const tool = card.dataset.tool;
    try {
      argsByTool[tool] = parseArgsFromCard(card);
    } catch (error) {
      updateResponse({
        ok: false,
        error: `工具 ${tool} 参数 JSON 解析失败: ${error.message}`,
      });
      return;
    }
  }

  const payload = await requestJson("/api/tools/run-all", {
    method: "POST",
    body: JSON.stringify({
      allowLive: getAllowLive(),
      argsByTool,
    }),
  });

  updateResponse(payload);
  renderRunAllSummary(payload);

  const results = payload?.data?.results ?? [];
  for (const item of results) {
    pushHistory({
      tool: item.tool,
      status: item.status,
      payload: item.envelope,
      time: nowText(),
    });
  }
}

async function bootstrap() {
  els.refreshBtn.addEventListener("click", async () => {
    await refreshBaseData();
  });
  els.runAllBtn.addEventListener("click", async () => {
    await runAllTools();
  });

  await refreshBaseData();
}

bootstrap().catch((error) => {
  updateResponse({
    ok: false,
    message: error?.message ?? String(error),
  });
});
