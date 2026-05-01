import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { publicClient } from "./chain.js";
import { CONTRACTS, CONDITIONAL_ORDER_ABI, KEEPERS_ABI, PERP_ABI } from "./contracts.js";
import { config } from "./config.js";
import { runtime } from "./state.js";
import { getTrackedPositions } from "./liquidator.js";
import { getTrackedOrderIds } from "./orders.js";
import { getMarketSnapshot } from "./marketData.js";
import { buildChatReplyWithLlm, buildStrategyInsights, buildTradeAdviceWithLlm, buildTradeDecision, tuneIdeasForPrompt } from "./ai.js";
import { fetchAiContractsState } from "./aiContracts.js";
import { fetchBusinessOverview } from "./businessFlows.js";
import { compileStrategyIntent } from "./strategyEngine.js";
import { botPerformanceSnapshot, configureBotAutoRun, createBot, exportBots, followBot, grantBotConsent, importBots, listBots, runBot } from "./botFactory.js";
import { log } from "./logger.js";
import { safeSend, account } from "./chain.js";
import { loadBotStore, saveBotStore } from "./botStore.js";
import { fetchOnchainBots, onchainBotsEnabled, registerOnchainBot, setOnchainBotActive } from "./onchainBots.js";
import { runAutomationOps } from "./automationOps.js";
import { runKeeperMaintenance } from "./keeperOps.js";
import { executeAllBusinessFlows, executeBusinessFlow, flowConfig, listBusinessFlowKeys } from "./businessOps.js";
import { appendChatMessage, createChatSession, deleteChatSession, getChatSession, listChatSessions, loadChatMemory, popLastAssistantMessage, renameChatSession, saveChatMemory } from "./chatMemory.js";

const preflightTickets = new Map();
const PREFLIGHT_TTL_MS = 2 * 60 * 1000;
let autoRunTimer = null;
const txStatusCache = new Map();

function safeJson(value) {
  return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
}


async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": config.corsOrigin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-api-key",
  });
  res.end(safeJson(payload));
}

function writeSseHead(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "access-control-allow-origin": config.corsOrigin,
  });
}

function writeMetrics(res, body) {
  res.writeHead(200, {
    "content-type": "text/plain; version=0.0.4; charset=utf-8",
    "access-control-allow-origin": config.corsOrigin,
  });
  res.end(body);
}

function onchainWriteReadiness() {
  const reasons = [];
  if (!config.liveExecutionEnabled) reasons.push("LIVE_EXECUTION_ENABLED=false");
  if (config.dryRun) reasons.push("DRY_RUN=true");
  return { ok: reasons.length === 0, reasons };
}

function getApiKey(req) {
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : "";
  const headerKey = req.headers["x-api-key"] || "";
  return `${bearer || headerKey}`;
}

export function isAuthorized(req) {
  if (!config.apiKey) return true;
  return getApiKey(req) === config.apiKey;
}

function isPrivateRoute(pathname) {
  return pathname === "/stats" || pathname === "/positions" || pathname === "/orders" || pathname === "/markets" || pathname === "/ai/strategy" || pathname === "/ai/contracts" || pathname === "/business/overview" || pathname === "/ai/strategy/compile" || pathname === "/ai/bots" || pathname.startsWith("/v1/");
}

async function protocolSnapshot() {
  try {
    const [keeperCount, pendingRewards, marketCount] = await Promise.all([
      publicClient.readContract({
        address: CONTRACTS.WikiKeeperRegistry,
        abi: KEEPERS_ABI,
        functionName: "keeperCount",
      }),
      publicClient.readContract({
        address: CONTRACTS.WikiKeeperRegistry,
        abi: KEEPERS_ABI,
        functionName: "totalPendingRewards",
      }),
      publicClient.readContract({
        address: CONTRACTS.WikiPerp,
        abi: PERP_ABI,
        functionName: "marketCount",
      }),
    ]);

    return {
      keeperCount,
      totalPendingRewards: pendingRewards,
      marketCount,
    };
  } catch {
    return null;
  }
}

async function wiringStatus() {
  const checks = [];
  const push = (name, ok, detail = "") => checks.push({ name, ok, detail });
  try {
    const count = await publicClient.readContract({
      address: CONTRACTS.WikiPerp,
      abi: PERP_ABI,
      functionName: "marketCount",
    });
    push("WikiPerp.marketCount", true, String(count));
  } catch (e) {
    push("WikiPerp.marketCount", false, e?.shortMessage || e?.message || "read-failed");
  }
  try {
    const nextOrderId = await publicClient.readContract({
      address: CONTRACTS.WikiConditionalOrder,
      abi: CONDITIONAL_ORDER_ABI,
      functionName: "nextOrderId",
    });
    push("WikiConditionalOrder.nextOrderId", true, String(nextOrderId));
  } catch (e) {
    push("WikiConditionalOrder.nextOrderId", false, e?.shortMessage || e?.message || "read-failed");
  }
  return {
    generatedAt: new Date().toISOString(),
    ok: checks.every((c) => c.ok),
    checks,
    liveExecutionEnabled: config.liveExecutionEnabled,
    dryRun: config.dryRun,
  };
}

function statsPayload(protocol) {
  return {
    config: {
      pollIntervalMs: config.pollIntervalMs,
      dryRun: config.dryRun,
      apiKeyEnabled: Boolean(config.apiKey),
    },
    runtime,
    protocol,
  };
}

function metricsPayload() {
  const lines = [
    "# HELP keeper_tick_count Total keeper ticks",
    "# TYPE keeper_tick_count counter",
    `keeper_tick_count ${runtime.tickCount || 0}`,
    "# HELP keeper_market_count Markets in snapshot",
    "# TYPE keeper_market_count gauge",
    `keeper_market_count ${runtime.marketData?.count || 0}`,
    "# HELP keeper_liquidations_sent Liquidation tx sent",
    "# TYPE keeper_liquidations_sent counter",
    `keeper_liquidations_sent ${runtime.liquidations?.sent || 0}`,
    "# HELP keeper_orders_sent Conditional order tx sent",
    "# TYPE keeper_orders_sent counter",
    `keeper_orders_sent ${runtime.conditionalOrders?.sent || 0}`,
    "# HELP keeper_funding_sent Funding settlement tx sent",
    "# TYPE keeper_funding_sent counter",
    `keeper_funding_sent ${runtime.funding?.sent || 0}`,
    "# HELP keeper_last_errors Number of recent errors cached",
    "# TYPE keeper_last_errors gauge",
    `keeper_last_errors ${runtime.lastErrors?.length || 0}`,
  ];
  return `${lines.join("\n")}\n`;
}

function toBigIntSafe(v, fallback = 0n) {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.max(0, Math.round(v)));
    if (typeof v === "string" && v.trim()) return BigInt(v);
  } catch {}
  return fallback;
}

function buildLiveOrderParams(bot, marketSnapshot, ownerOverride) {
  const idea = bot?.compiledStrategy?.selectedIdea;
  const m = (marketSnapshot?.markets || []).find((x) => String(x.marketIndex) === String(idea?.marketIndex));
  if (!idea || !m) return null;
  const basePrice = toBigIntSafe(m?.price, 0n);
  if (basePrice <= 0n) return null;
  const risk = bot?.executionPlan?.riskPlan || {};
  const sizing = bot?.executionPlan?.sizing || bot?.compiledStrategy?.sizing || {};
  const tpBps = BigInt(Math.max(20, Number(risk.takeProfitBps || 120)));
  const slBps = BigInt(Math.max(20, Number(risk.stopLossBps || 80)));
  const isLong = idea.action !== "short-bias";
  const one = 10_000n;
  const tpPrice = isLong ? (basePrice * (one + tpBps)) / one : (basePrice * (one - tpBps)) / one;
  const slPrice = isLong ? (basePrice * (one - slBps)) / one : (basePrice * (one + slBps)) / one;
  const recommendedNotional = Number(sizing?.recommendedNotionalUsd || bot?.compiledStrategy?.constraints?.maxNotionalUsd || 0);
  return {
    owner: ownerOverride || account.address,
    marketId: m.marketId,
    collateral: 0n,
    size: toBigIntSafe(recommendedNotional, 0n),
    tpPrice,
    slPrice,
    triggerPrice: basePrice,
    triggerType: 0,
    isLong,
    isReduceOnly: false,
  };
}

function buildBotRecommendation(bot) {
  if (!bot) return null;
  const selectedIdea = bot?.compiledStrategy?.selectedIdea || null;
  const sizing = bot?.compiledStrategy?.sizing || bot?.executionPlan?.sizing || {};
  const riskPlan = bot?.executionPlan?.riskPlan || {};
  const confidence = Number(selectedIdea?.adjustedConfidence ?? selectedIdea?.confidence ?? 0);
  const score = Number((confidence * 100 - Number(selectedIdea?.setup?.volatilityBps || 0) / 20).toFixed(2));
  return {
    botId: bot.id,
    generatedAt: new Date().toISOString(),
    selectedIdea: selectedIdea ? {
      symbol: selectedIdea.symbol,
      action: selectedIdea.action,
      confidence,
      reason: selectedIdea.reason,
      patterns: selectedIdea?.setup?.patterns || [],
    } : null,
    sizing: {
      recommendedNotionalUsd: Number(sizing?.recommendedNotionalUsd || 0),
      maxNotionalUsd: Number(bot?.compiledStrategy?.constraints?.maxNotionalUsd || 0),
      scaler: Number(sizing?.scaler || 0),
      confidenceTier: sizing?.confidenceTier || "low",
    },
    risk: {
      stopLossBps: Number(riskPlan?.stopLossBps || 0),
      takeProfitBps: Number(riskPlan?.takeProfitBps || 0),
      rewardToRisk: riskPlan?.stopLossBps ? Number((Number(riskPlan.takeProfitBps || 0) / Number(riskPlan.stopLossBps)).toFixed(2)) : null,
    },
    executionReadinessScore: score,
  };
}

function evaluateLiveReadiness(bot, marketSnapshot, ownerOverride) {
  const reasons = [];
  const idea = bot?.compiledStrategy?.selectedIdea;
  if (!idea) reasons.push("selected-idea-missing");
  const confidence = Number(idea?.adjustedConfidence ?? idea?.confidence ?? 0);
  if (confidence < Number(config.liveMinConfidence || 0.6)) reasons.push("confidence-below-threshold");
  const volatilityBps = Number(idea?.setup?.volatilityBps || 0);
  if (volatilityBps > Number(config.liveMaxVolatilityBps || 450)) reasons.push("volatility-too-high");
  const notionalUsd = Number(bot?.compiledStrategy?.constraints?.maxNotionalUsd || 0);
  if (notionalUsd > Number(config.liveMaxNotionalUsd || 10000)) reasons.push("notional-too-large");
  const params = buildLiveOrderParams(bot, marketSnapshot, ownerOverride);
  if (!params) reasons.push("order-params-unavailable");
  return {
    ok: reasons.length === 0,
    reasons,
    guardrails: {
      minConfidence: Number(config.liveMinConfidence || 0.6),
      maxVolatilityBps: Number(config.liveMaxVolatilityBps || 450),
      maxNotionalUsd: Number(config.liveMaxNotionalUsd || 10000),
    },
    observed: {
      confidence,
      volatilityBps,
      maxNotionalUsd: notionalUsd,
    },
    params,
  };
}

async function preflightLiveOrder(params) {
  if (!params) return { ok: false, reason: "params-missing" };
  try {
    await publicClient.simulateContract({
      address: CONTRACTS.WikiConditionalOrder,
      abi: CONDITIONAL_ORDER_ABI,
      functionName: "createOrder",
      args: [params],
      account: account.address,
    });
    return { ok: true, reason: "simulation-passed" };
  } catch (e) {
    return { ok: false, reason: e?.shortMessage || e?.message || "simulation-failed" };
  }
}

async function fetchTxStatus(txHash, waitMs = 0) {
  if (!txHash) return { txHash: null, status: "not-submitted" };
  const key = String(txHash).toLowerCase();
  const cached = txStatusCache.get(key);
  if (cached?.status === "confirmed" || cached?.status === "reverted") return cached;
  try {
    let receipt = null;
    if (waitMs > 0) {
      receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: waitMs });
    } else {
      receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    }
    const payload = {
      txHash,
      status: receipt?.status === "success" ? "confirmed" : "reverted",
      blockNumber: receipt?.blockNumber ?? null,
      gasUsed: receipt?.gasUsed ?? null,
      confirmedAt: new Date().toISOString(),
      receipt,
    };
    txStatusCache.set(key, payload);
    return payload;
  } catch (e) {
    const msg = String(e?.shortMessage || e?.message || "");
    if (msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("wait for transaction receipt")) {
      return { txHash, status: "pending", message: msg || "pending" };
    }
    return { txHash, status: "unknown", message: msg || "status-check-failed" };
  }
}

function createPreflightTicket({ botId, owner, params }) {
  const id = randomUUID();
  const createdAt = Date.now();
  const expiresAt = createdAt + PREFLIGHT_TTL_MS;
  preflightTickets.set(id, { botId: String(botId), owner: owner || "", params, createdAt, expiresAt });
  return { id, createdAt: new Date(createdAt).toISOString(), expiresAt: new Date(expiresAt).toISOString() };
}

function getPreflightTicket(id) {
  const row = preflightTickets.get(String(id || ""));
  if (!row) return null;
  if (Date.now() > row.expiresAt) {
    preflightTickets.delete(String(id));
    return null;
  }
  return row;
}

async function persistBots() {
  await saveBotStore({ bots: exportBots() });
}

async function persistChat() {
  await saveChatMemory();
}

function startAutoRunLoop() {
  if (autoRunTimer) return;
  autoRunTimer = setInterval(async () => {
    const snapshot = getMarketSnapshot();
    const now = Date.now();
    const bots = listBots().filter((b) => b?.autoRun?.enabled);
    for (const bot of bots) {
      const nextRunAtMs = bot?.autoRun?.nextRunAt ? Date.parse(bot.autoRun.nextRunAt) : 0;
      if (nextRunAtMs && now < nextRunAtMs) continue;
      const intervalSec = Math.max(10, Number(bot?.autoRun?.intervalSec || 30));
      bot.autoRun.nextRunAt = new Date(now + intervalSec * 1000).toISOString();
      await runBot(bot.id, snapshot, { runMode: bot?.autoRun?.mode === "live" ? "live" : "paper" });
    }
    if (bots.length > 0) {
      try {
        await persistBots();
      } catch (e) {
        log("warn", "autorun_persist_failed", { message: e?.message || String(e) });
      }
    }
  }, 5000);
}

export function startBackendServer() {
  if (!config.apiEnabled) return;

  loadBotStore()
    .then((payload) => {
      importBots(payload?.bots || []);
      startAutoRunLoop();
      log("info", "bot_store_loaded", { bots: (payload?.bots || []).length });
    })
    .catch((e) => log("warn", "bot_store_load_failed", { message: e?.message || String(e) }));

  loadChatMemory().catch((e) => log("warn", "chat_memory_load_failed", { message: e?.message || String(e) }));

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "OPTIONS") {
      return writeJson(res, 204, {});
    }

    const t0 = Date.now();

    if (isPrivateRoute(url.pathname) && !isAuthorized(req)) {
      return writeJson(res, 401, { error: "Unauthorized" });
    }

    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
      const body = { ok: true, startedAt: runtime.startedAt, now: new Date().toISOString(), uptimeSec: Math.floor(process.uptime()) };
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0 });
      return writeJson(res, 200, body);
    }

    if (req.method === "GET" && url.pathname === "/metrics") {
      return writeMetrics(res, metricsPayload());
    }

    if (req.method === "GET" && (url.pathname === "/stats" || url.pathname === "/v1/stats")) {
      const snapshot = await protocolSnapshot();
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0 });
      return writeJson(res, 200, statsPayload(snapshot));
    }

    if (req.method === "GET" && (url.pathname === "/automation/status" || url.pathname === "/v1/automation/status")) {
      return writeJson(res, 200, {
        keeper: runtime.keeper,
        automation: runtime.automation,
      });
    }

    if (req.method === "GET" && (url.pathname === "/automation/history" || url.pathname === "/v1/automation/history")) {
      return writeJson(res, 200, {
        generatedAt: new Date().toISOString(),
        history: runtime.automation?.history || [],
      });
    }

    if (req.method === "POST" && (url.pathname === "/automation/run" || url.pathname === "/v1/automation/run")) {
      const body = await readJsonBody(req);
      const strict = Boolean(body?.strict);
      if (strict) {
        const readiness = onchainWriteReadiness();
        if (!readiness.ok) {
          return writeJson(res, 409, {
            ok: false,
            error: "onchain-write-not-ready",
            readiness,
          });
        }
      }
      const payload = await runAutomationOps();
      if (strict) {
        const taskRows = Object.values(payload || {});
        const sent = taskRows.filter((x) => Boolean(x?.txHash)).length;
        if (sent === 0) {
          return writeJson(res, 409, {
            ok: false,
            error: "no-automation-transactions-submitted",
            payload,
          });
        }
      }
      return writeJson(res, 200, { ok: true, payload });
    }

    if (req.method === "POST" && (url.pathname === "/keeper/maintenance/run" || url.pathname === "/v1/keeper/maintenance/run")) {
      const body = await readJsonBody(req);
      const strict = Boolean(body?.strict);
      if (strict) {
        const readiness = onchainWriteReadiness();
        if (!readiness.ok) {
          return writeJson(res, 409, {
            ok: false,
            error: "onchain-write-not-ready",
            readiness,
          });
        }
      }
      const payload = await runKeeperMaintenance({
        autoRegister: body?.autoRegister ?? true,
        autoClaim: body?.autoClaim ?? true,
      });
      if (strict && !payload?.registerTx && !payload?.claimTx) {
        return writeJson(res, 409, {
          ok: false,
          error: "no-keeper-transactions-submitted",
          payload,
        });
      }
      return writeJson(res, 200, { ok: true, payload });
    }

    if (req.method === "GET" && (url.pathname === "/automation/gap-status" || url.pathname === "/v1/automation/gap-status")) {
      const status = {
        adlKeeper: Boolean(config.adlKeeperAddress),
        trailingStop: Boolean(config.trailingStopAddress),
        guaranteedStop: Boolean(config.guaranteedStopAddress),
        twamm: Boolean(config.twammAddress),
        keeperRegisterClaim: Boolean(config.keeperAutoRegister || config.keeperAutoClaim),
        autoCompounder: Boolean(config.autoCompounderAddress),
        fundingArbBackstop: Boolean(config.fundingArbVaultAddress || config.gmxBackstopAddress),
        idleYieldRouter: Boolean(config.idleYieldRouterAddress),
        externalFeeds: Boolean(config.pythPriceUrl || config.chainlinkPriceUrl),
        eip1559: true,
        positionPersistence: true,
        prometheusMetrics: true,
        aiModelUpgrade: Boolean(config.openaiApiKey),
        telegramGateway: Boolean(config.telegramGatewayAddress || (config.telegramBotToken && config.telegramChatId)),
        circuitResetPath: Boolean(config.circuitAutoReset),
        multiWalletGas: Boolean(config.gasPrivateKey),
      };
      return writeJson(res, 200, { generatedAt: new Date().toISOString(), status });
    }

    if (req.method === "GET" && (url.pathname === "/positions" || url.pathname === "/v1/positions")) {
      const positions = getTrackedPositions().map((x) => x.toString());
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0 });
      return writeJson(res, 200, { count: positions.length, positionIds: positions });
    }

    if (req.method === "GET" && (url.pathname === "/orders" || url.pathname === "/v1/orders")) {
      const orders = getTrackedOrderIds().map((x) => x.toString());
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0 });
      return writeJson(res, 200, { count: orders.length, orderIds: orders });
    }

    if (req.method === "GET" && (url.pathname === "/markets" || url.pathname === "/v1/markets")) {
      const snapshot = getMarketSnapshot();
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0 });
      return writeJson(res, 200, snapshot);
    }

    if (req.method === "GET" && (url.pathname === "/business/overview" || url.pathname === "/v1/business/overview")) {
      const payload = await fetchBusinessOverview();
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0 });
      return writeJson(res, 200, payload);
    }

    if (req.method === "GET" && (url.pathname === "/business/flows" || url.pathname === "/v1/business/flows")) {
      const payload = listBusinessFlowKeys().map((key) => ({
        key,
        configured: Boolean(flowConfig(key)?.address?.()),
      }));
      return writeJson(res, 200, { generatedAt: new Date().toISOString(), flows: payload });
    }

    if (req.method === "POST" && (url.pathname === "/business/execute" || url.pathname === "/v1/business/execute")) {
      const body = await readJsonBody(req);
      const strict = Boolean(body?.strict);
      if (strict) {
        const readiness = onchainWriteReadiness();
        if (!readiness.ok) return writeJson(res, 409, { ok: false, error: "onchain-write-not-ready", readiness });
      }
      const flow = String(body?.flow || "");
      if (!flow) return writeJson(res, 400, { ok: false, error: "flow-required", supported: listBusinessFlowKeys() });
      const payload = await executeBusinessFlow(flow);
      if (strict && !payload?.txHash) return writeJson(res, 409, { ok: false, error: "no-business-flow-transaction-submitted", payload });
      return writeJson(res, 200, { ok: Boolean(payload?.txHash), payload });
    }

    if (req.method === "POST" && (url.pathname === "/business/execute-all" || url.pathname === "/v1/business/execute-all")) {
      const body = await readJsonBody(req);
      const strict = Boolean(body?.strict);
      if (strict) {
        const readiness = onchainWriteReadiness();
        if (!readiness.ok) return writeJson(res, 409, { ok: false, error: "onchain-write-not-ready", readiness });
      }
      const payload = await executeAllBusinessFlows();
      const sent = Object.values(payload || {}).filter((x) => Boolean(x?.txHash)).length;
      if (strict && sent === 0) return writeJson(res, 409, { ok: false, error: "no-business-flow-transactions-submitted", payload });
      return writeJson(res, 200, { ok: sent > 0, sent, payload });
    }

    if (req.method === "GET" && (url.pathname === "/ai/contracts" || url.pathname === "/v1/ai/contracts")) {
      const payload = await fetchAiContractsState();
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0 });
      return writeJson(res, 200, payload);
    }

    if (req.method === "GET" && (url.pathname === "/ai/chat/sessions" || url.pathname === "/v1/ai/chat/sessions")) {
      return writeJson(res, 200, { sessions: listChatSessions() });
    }

    if (req.method === "POST" && (url.pathname === "/ai/chat/sessions" || url.pathname === "/v1/ai/chat/sessions")) {
      const body = await readJsonBody(req);
      const session = createChatSession(body?.title || "New chat");
      await persistChat();
      return writeJson(res, 200, { session });
    }

    if (req.method === "PATCH" && (url.pathname === "/ai/chat/sessions" || url.pathname === "/v1/ai/chat/sessions")) {
      const body = await readJsonBody(req);
      const session = renameChatSession(body?.sessionId, body?.title || "New chat");
      if (!session) return writeJson(res, 404, { error: "Session not found" });
      await persistChat();
      return writeJson(res, 200, { session });
    }

    if (req.method === "DELETE" && (url.pathname === "/ai/chat/sessions" || url.pathname === "/v1/ai/chat/sessions")) {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) return writeJson(res, 400, { error: "sessionId-required" });
      const removed = deleteChatSession(sessionId);
      if (!removed) return writeJson(res, 404, { error: "Session not found" });
      await persistChat();
      return writeJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && (url.pathname === "/ai/chat/history" || url.pathname === "/v1/ai/chat/history")) {
      const sessionId = url.searchParams.get("sessionId");
      const session = getChatSession(sessionId);
      if (!session) return writeJson(res, 404, { error: "Session not found" });
      return writeJson(res, 200, { session });
    }

    if (req.method === "POST" && (url.pathname === "/ai/chat/message" || url.pathname === "/v1/ai/chat/message")) {
      const body = await readJsonBody(req);
      let text = String(body?.message || "").trim();
      const regenerate = Boolean(body?.regenerate);
      if (!text && !regenerate) return writeJson(res, 400, { error: "message-required" });
      let session = getChatSession(body?.sessionId);
      if (!session) session = createChatSession((text || "New chat").slice(0, 64));
      if (regenerate) {
        popLastAssistantMessage(session.id);
        const latest = getChatSession(session.id)?.messages || [];
        const lastUser = [...latest].reverse().find((m) => m?.role === "user");
        text = String(lastUser?.text || "").trim();
        if (!text) return writeJson(res, 400, { error: "no-user-message-to-regenerate" });
      } else {
        appendChatMessage(session.id, { role: "user", text, at: new Date().toISOString() });
      }
      const conversation = getChatSession(session.id)?.messages || [];

      const snapshot = getMarketSnapshot();
      const rawInsights = buildStrategyInsights(snapshot);
      const tunedIdeas = tuneIdeasForPrompt(rawInsights.topIdeas || [], text);
      const insights = { ...rawInsights, topIdeas: tunedIdeas };
      const minConfidence = Number(body?.minConfidence || 0.55);
      const maxVolatilityBps = Math.max(50, Math.min(2000, Number(body?.maxVolatilityBps || 420)));
      const advice = await buildTradeAdviceWithLlm(insights, {
        minConfidence,
        openaiApiKey: config.openaiApiKey,
        openaiModel: config.openaiModel,
      });
      const openPositions = getTrackedPositions().length;
      const decision = buildTradeDecision(advice, { minConfidence, maxVolatilityBps, openPositions });
      let assistantText = await buildChatReplyWithLlm(
        { prompt: text, conversation, advice, insights },
        { openaiApiKey: config.openaiApiKey, openaiModel: config.openaiModel }
      );
      if (!decision?.allowTrade) {
        const flags = Array.isArray(decision?.riskFlags) && decision.riskFlags.length > 0 ? decision.riskFlags.join(", ") : "risk-gates";
        assistantText = `Risk Gate: BLOCKED (${flags}). ${assistantText}`;
      }
      appendChatMessage(session.id, { role: "assistant", text: assistantText, at: new Date().toISOString(), meta: { decision } });
      await persistChat();
      const updated = getChatSession(session.id);
      return writeJson(res, 200, {
        sessionId: session.id,
        assistant: assistantText,
        advice,
        decision,
        session: updated,
        regenerated: regenerate,
      });
    }

    if (req.method === "GET" && (url.pathname === "/ai/onchain-bots" || url.pathname === "/v1/ai/onchain-bots")) {
      const payload = await fetchOnchainBots(Number(url.searchParams.get("limit") || 20));
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0, enabled: payload.enabled });
      return writeJson(res, 200, payload);
    }

    if (req.method === "GET" && (url.pathname === "/ai/wiring/status" || url.pathname === "/v1/ai/wiring/status")) {
      const payload = await wiringStatus();
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0, ok: payload.ok });
      return writeJson(res, 200, payload);
    }

    if (req.method === "GET" && (url.pathname === "/ai/strategy" || url.pathname === "/v1/ai/strategy")) {
      const snapshot = getMarketSnapshot();
      const prompt = url.searchParams.get("prompt") || "";
      const rawInsights = buildStrategyInsights(snapshot);
      const tunedIdeas = tuneIdeasForPrompt(rawInsights.topIdeas || [], prompt);
      const insights = { ...rawInsights, topIdeas: tunedIdeas };
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0 });
      return writeJson(res, 200, insights);
    }

    if (req.method === "GET" && (url.pathname === "/ai/opportunities" || url.pathname === "/v1/ai/opportunities")) {
      const snapshot = getMarketSnapshot();
      const prompt = url.searchParams.get("prompt") || "";
      const rawInsights = buildStrategyInsights(snapshot);
      const tunedIdeas = tuneIdeasForPrompt(rawInsights.topIdeas || [], prompt);
      const insights = { ...rawInsights, topIdeas: tunedIdeas };
      const minConfidence = Number(url.searchParams.get("minConfidence") || 0);
      const maxIdeas = Math.max(1, Math.min(20, Number(url.searchParams.get("limit") || 5)));
      const opportunities = (insights.topIdeas || [])
        .filter((i) => i.action !== "wait" && Number(i.adjustedConfidence ?? i.confidence ?? 0) >= minConfidence)
        .slice(0, maxIdeas);
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0 });
      return writeJson(res, 200, {
        generatedAt: insights.generatedAt,
        model: insights.model,
        opportunities,
      });
    }

    if (req.method === "GET" && (url.pathname === "/ai/opportunities/stream" || url.pathname === "/v1/ai/opportunities/stream")) {
      const minConfidence = Number(url.searchParams.get("minConfidence") || 0.55);
      const maxIdeas = Math.max(1, Math.min(20, Number(url.searchParams.get("limit") || 5)));
      writeSseHead(res);
      const push = () => {
        const snapshot = getMarketSnapshot();
        const prompt = url.searchParams.get("prompt") || "";
        const rawInsights = buildStrategyInsights(snapshot);
        const tunedIdeas = tuneIdeasForPrompt(rawInsights.topIdeas || [], prompt);
        const insights = { ...rawInsights, topIdeas: tunedIdeas };
        const opportunities = (insights.topIdeas || [])
          .filter((i) => i.action !== "wait" && Number(i.adjustedConfidence ?? i.confidence ?? 0) >= minConfidence)
          .slice(0, maxIdeas);
        res.write(`event: opportunities\n`);
        res.write(`data: ${safeJson({ generatedAt: insights.generatedAt, opportunities })}\n\n`);
      };
      push();
      const timer = setInterval(push, 5000);
      req.on("close", () => clearInterval(timer));
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0, stream: true });
      return;
    }

    if (req.method === "GET" && (url.pathname === "/ai/advice" || url.pathname === "/v1/ai/advice")) {
      const snapshot = getMarketSnapshot();
      const prompt = url.searchParams.get("prompt") || "";
      const minConfidence = Number(url.searchParams.get("minConfidence") || 0.55);
      const rawInsights = buildStrategyInsights(snapshot);
      const tunedIdeas = tuneIdeasForPrompt(rawInsights.topIdeas || [], prompt);
      const advice = await buildTradeAdviceWithLlm(
        { ...rawInsights, topIdeas: tunedIdeas },
        { minConfidence, openaiApiKey: config.openaiApiKey, openaiModel: config.openaiModel },
      );
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0 });
      return writeJson(res, 200, advice);
    }

    if (req.method === "GET" && (url.pathname === "/ai/research" || url.pathname === "/v1/ai/research")) {
      const snapshot = getMarketSnapshot();
      const prompt = url.searchParams.get("prompt") || "";
      const rawInsights = buildStrategyInsights(snapshot);
      const tunedIdeas = tuneIdeasForPrompt(rawInsights.topIdeas || [], prompt);
      const best = tunedIdeas[0] || null;
      const research = {
        generatedAt: new Date().toISOString(),
        prompt,
        marketCount: snapshot?.count || 0,
        regimeMix: {
          overheatedLongs: tunedIdeas.filter((x) => x.regime === "overheated-longs").length,
          overheatedShorts: tunedIdeas.filter((x) => x.regime === "overheated-shorts").length,
          balanced: tunedIdeas.filter((x) => x.regime === "balanced").length,
        },
        topSignal: best ? {
          symbol: best.symbol,
          action: best.action,
          confidence: Number(best.adjustedConfidence ?? best.confidence ?? 0),
          reason: best.reason,
          patterns: best.setup?.patterns || [],
        } : null,
      };
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0 });
      return writeJson(res, 200, research);
    }

    if (req.method === "POST" && (url.pathname === "/ai/strategy/compile" || url.pathname === "/v1/ai/strategy/compile")) {
      const body = await readJsonBody(req);
      const marketSnapshot = getMarketSnapshot();
      const aiContracts = await fetchAiContractsState();
      const business = await fetchBusinessOverview();
      const compiled = compileStrategyIntent(body, marketSnapshot, aiContracts, business);
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0 });
      return writeJson(res, 200, compiled);
    }

    if (req.method === "POST" && (url.pathname === "/ai/bots" || url.pathname === "/v1/ai/bots")) {
      const body = await readJsonBody(req);
      const marketSnapshot = getMarketSnapshot();
      const aiContracts = await fetchAiContractsState();
      const business = await fetchBusinessOverview();
      const compiled = compileStrategyIntent(body, marketSnapshot, aiContracts, business);
      const bot = createBot(compiled);
      await persistBots();
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0 });
      return writeJson(res, 200, bot);
    }

    if (req.method === "POST" && (url.pathname === "/ai/onchain-bots/register" || url.pathname === "/v1/ai/onchain-bots/register")) {
      if (!onchainBotsEnabled()) return writeJson(res, 400, { error: "ONCHAIN_BOT_MANAGER not configured" });
      const body = await readJsonBody(req);
      const localBot = listBots().find((x) => String(x.id) === String(body?.id));
      if (!localBot) return writeJson(res, 404, { error: "Local bot not found" });
      const idea = localBot?.compiledStrategy?.selectedIdea;
      const market = (getMarketSnapshot()?.markets || []).find((m) => String(m.marketIndex) === String(idea?.marketIndex));
      if (!market) return writeJson(res, 400, { error: "Missing market context for bot" });
      const payload = await registerOnchainBot({
        owner: body?.owner,
        marketId: market.marketId,
        isLong: idea?.action !== "short-bias",
        maxNotional: localBot?.compiledStrategy?.constraints?.maxNotionalUsd || 0,
      });
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0, tx: payload?.txHash || null });
      const txStatus = payload?.txHash ? await fetchTxStatus(payload.txHash, Number(body?.waitMs || 0)) : { txHash: null, status: "not-submitted" };
      return writeJson(res, 200, { ok: true, ...payload, txStatus });
    }

    if (req.method === "POST" && (url.pathname === "/ai/onchain-bots/toggle" || url.pathname === "/v1/ai/onchain-bots/toggle")) {
      if (!onchainBotsEnabled()) return writeJson(res, 400, { error: "ONCHAIN_BOT_MANAGER not configured" });
      const body = await readJsonBody(req);
      const payload = await setOnchainBotActive({ botId: body?.botId, active: body?.active });
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0, tx: payload?.txHash || null });
      const txStatus = payload?.txHash ? await fetchTxStatus(payload.txHash, Number(body?.waitMs || 0)) : { txHash: null, status: "not-submitted" };
      return writeJson(res, 200, { ok: true, ...payload, txStatus });
    }

    if (req.method === "GET" && (url.pathname === "/ai/tx/status" || url.pathname === "/v1/ai/tx/status")) {
      const txHash = url.searchParams.get("txHash") || "";
      if (!txHash) return writeJson(res, 400, { error: "txHash required" });
      const payload = await fetchTxStatus(txHash, Number(url.searchParams.get("waitMs") || 0));
      return writeJson(res, 200, payload);
    }

    if (req.method === "POST" && (url.pathname === "/ai/tx/status" || url.pathname === "/v1/ai/tx/status")) {
      const body = await readJsonBody(req);
      if (!body?.txHash) return writeJson(res, 400, { error: "txHash required" });
      const payload = await fetchTxStatus(body.txHash, Number(body?.waitMs || 0));
      return writeJson(res, 200, payload);
    }

    if (req.method === "GET" && (url.pathname === "/ai/bots" || url.pathname === "/v1/ai/bots")) {
      const items = listBots();
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0 });
      return writeJson(res, 200, { bots: items });
    }

    if (req.method === "GET" && (url.pathname === "/ai/bots/performance" || url.pathname === "/v1/ai/bots/performance")) {
      const payload = botPerformanceSnapshot();
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0 });
      return writeJson(res, 200, payload);
    }

    if (req.method === "GET" && (url.pathname === "/ai/bots/recommendation" || url.pathname === "/v1/ai/bots/recommendation")) {
      const id = url.searchParams.get("id");
      const bot = listBots().find((x) => String(x.id) === String(id || ""));
      if (!bot) return writeJson(res, 404, { error: "Bot not found" });
      const payload = buildBotRecommendation(bot);
      return writeJson(res, 200, payload);
    }

    if (req.method === "POST" && (url.pathname === "/ai/bots/follow" || url.pathname === "/v1/ai/bots/follow")) {
      const body = await readJsonBody(req);
      const payload = followBot(body?.id, body?.followerId, body?.allocationUsd);
      if (!payload) return writeJson(res, 404, { error: "Bot not found" });
      if (payload?.error) return writeJson(res, 400, payload);
      await persistBots();
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0 });
      return writeJson(res, 200, payload);
    }

    if (req.method === "POST" && (url.pathname === "/ai/bots/autorun" || url.pathname === "/v1/ai/bots/autorun")) {
      const body = await readJsonBody(req);
      const payload = configureBotAutoRun(body?.id, {
        enabled: body?.enabled,
        mode: body?.mode,
        intervalSec: body?.intervalSec,
      });
      if (!payload) return writeJson(res, 404, { error: "Bot not found" });
      await persistBots();
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0 });
      return writeJson(res, 200, payload);
    }

    if (req.method === "POST" && (url.pathname === "/ai/bots/preflight" || url.pathname === "/v1/ai/bots/preflight")) {
      const body = await readJsonBody(req);
      const bot = listBots().find((x) => String(x.id) === String(body?.id));
      if (!bot) return writeJson(res, 404, { error: "Bot not found" });
      const snapshot = getMarketSnapshot();
      const readiness = evaluateLiveReadiness(bot, snapshot, body?.owner);
      if (!readiness.ok) {
        return writeJson(res, 200, {
          botId: bot.id,
          liveExecutionEnabled: config.liveExecutionEnabled,
          preflight: { ok: false, reason: `readiness-failed: ${readiness.reasons.join(",")}` },
          readiness,
          params: readiness.params || null,
          ticket: null,
        });
      }
      const params = readiness.params;
      const preflight = await preflightLiveOrder(params);
      const ticket = preflight.ok ? createPreflightTicket({ botId: bot.id, owner: body?.owner, params }) : null;
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0, preflightOk: preflight.ok });
      return writeJson(res, 200, {
        botId: bot.id,
        liveExecutionEnabled: config.liveExecutionEnabled,
        preflight,
        readiness,
        params,
        ticket,
      });
    }

    if (req.method === "POST" && (url.pathname === "/ai/bots/run" || url.pathname === "/v1/ai/bots/run")) {
      const body = await readJsonBody(req);
      const snapshot = getMarketSnapshot();
      const wantsLive = body?.runMode === "live";
      if (!wantsLive) {
        return writeJson(res, 400, { error: "runMode=live required", hint: "Paper execution is disabled; use real on-chain mode." });
      }
      if (!config.liveExecutionEnabled) {
        return writeJson(res, 400, { error: "LIVE_EXECUTION_ENABLED=false", hint: "Set LIVE_EXECUTION_ENABLED=true to submit real transactions." });
      }
      const runMode = "live";
      const ticket = getPreflightTicket(body?.preflightId);
      if (!ticket || String(ticket.botId) !== String(body?.id)) {
        return writeJson(res, 400, { error: "valid preflight required", hint: "Call /v1/ai/bots/preflight first" });
      }
      let result = null;
      try {
        result = await runBot(body?.id, snapshot, {
          runMode,
          strictOnchain: true,
          liveExecutor: async (bot) => {
            const readiness = evaluateLiveReadiness(bot, snapshot, body?.owner);
            if (!readiness.ok) throw new Error(`readiness-failed: ${readiness.reasons.join(",")}`);
            const ticket = getPreflightTicket(body?.preflightId);
            const params = ticket?.params || buildLiveOrderParams(bot, snapshot, body?.owner);
            if (!params) return { txHash: null };
            const preflight = await preflightLiveOrder(params);
            if (!preflight.ok) throw new Error(`preflight-failed: ${preflight.reason}`);
            const txHash = await safeSend({
              address: CONTRACTS.WikiConditionalOrder,
              abi: CONDITIONAL_ORDER_ABI,
              functionName: "createOrder",
              args: [params],
              label: `botLiveCreateOrder#${bot.id}`,
            });
            return { txHash };
          },
        });
      } catch (e) {
        return writeJson(res, 409, {
          error: "onchain execution failed",
          reason: e?.message || String(e),
          liveExecutionEnabled: config.liveExecutionEnabled,
        });
      }
      if (!result) return writeJson(res, 404, { error: "Bot not found" });
      if (!result?.lastOnchainTx) {
        return writeJson(res, 409, { error: "onchain transaction not submitted", status: result.status, reason: result.lastRunReason });
      }
      await persistBots();
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0 });
      const txStatus = result?.lastOnchainTx ? await fetchTxStatus(result.lastOnchainTx, Number(body?.waitMs || 0)) : { txHash: null, status: "not-submitted" };
      return writeJson(res, 200, { ...result, liveExecutionEnabled: config.liveExecutionEnabled, txStatus });
    }

    if (req.method === "POST" && (url.pathname === "/ai/bots/consent" || url.pathname === "/v1/ai/bots/consent")) {
      const body = await readJsonBody(req);
      const result = grantBotConsent(body?.id, body?.signer || "user");
      if (!result) return writeJson(res, 404, { error: "Bot not found" });
      await persistBots();
      log("info", "api_request", { path: url.pathname, status: 200, durMs: Date.now() - t0 });
      return writeJson(res, 200, result);
    }

    log("warn", "api_request_not_found", { path: url.pathname, status: 404, durMs: Date.now() - t0 });
    return writeJson(res, 404, { error: "Not found" });
  });

  server.listen(config.apiPort, config.apiHost, () => {
    log("info", "api_started", { host: config.apiHost, port: config.apiPort, protected: Boolean(config.apiKey) });
  });

  process.on("SIGINT", () => server.close());
  process.on("SIGTERM", () => server.close());
}
