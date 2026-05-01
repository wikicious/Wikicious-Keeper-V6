import { buildExecutionPlan } from "./strategyEngine.js";

const bots = new Map();
let nextBotId = 1;
const MIN_RUN_INTERVAL_MS = 10_000;

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function simulatePaperResult(bot, marketSnapshot) {
  const selectedIdea = bot?.compiledStrategy?.selectedIdea;
  if (!selectedIdea) return null;
  const market = (marketSnapshot?.markets || []).find((m) => String(m.marketIndex) === String(selectedIdea.marketIndex));
  if (!market) return null;
  const entryPrice = toNum(market?.price, 0);
  if (!entryPrice) return null;
  const momentum = toNum(market?.signals?.momentumBps, 0) / 10_000;
  const drift = selectedIdea.action === "long-bias" ? momentum : -momentum;
  const realizedPnlPct = Number((drift * 0.4).toFixed(5));
  const notional = toNum(bot?.compiledStrategy?.constraints?.maxNotionalUsd, 0);
  const realizedPnlUsd = Number((notional * realizedPnlPct).toFixed(2));
  const outcome = realizedPnlUsd > 0 ? "win" : realizedPnlUsd < 0 ? "loss" : "flat";
  return {
    symbol: market.symbol,
    marketIndex: market.marketIndex,
    entryPrice,
    projectedExitPrice: Number((entryPrice * (1 + realizedPnlPct)).toFixed(2)),
    realizedPnlPct,
    realizedPnlUsd,
    outcome,
    simulatedAt: new Date().toISOString(),
  };
}

export function createBot(compiledStrategy) {
  const id = String(nextBotId++);
  const plan = buildExecutionPlan(compiledStrategy);
  const bot = {
    id,
    createdAt: new Date().toISOString(),
    status: "ready",
    compiledStrategy,
    executionPlan: plan,
    consent: {
      required: Boolean(plan?.requiresConsent),
      granted: false,
      grantedAt: null,
      signer: null,
    },
    runs: 0,
    wins: 0,
    losses: 0,
    grossPnlUsd: 0,
    followers: [],
    mirroredExecutions: [],
    lastRunAt: null,
    lastRunReason: null,
    auditTrail: [],
    autoRun: {
      enabled: false,
      mode: "live",
      intervalSec: 30,
      nextRunAt: null,
    },
  };
  bot.auditTrail.push({ at: bot.createdAt, action: "created" });
  bots.set(id, bot);
  return bot;
}

export function listBots() {
  return Array.from(bots.values()).sort((a, b) => Number(b.id) - Number(a.id));
}

export async function runBot(id, marketSnapshot = null, options = {}) {
  const bot = bots.get(String(id));
  if (!bot) return null;
  if (bot.consent.required && !bot.consent.granted) {
    bot.status = "awaiting-consent";
    bot.lastRunReason = "consent-required";
    bot.auditTrail.push({ at: new Date().toISOString(), action: "run_blocked", reason: "consent-required" });
    return bot;
  }
  const now = Date.now();
  const lastRunTs = bot.lastRunAt ? Date.parse(bot.lastRunAt) : 0;
  if (lastRunTs && Number.isFinite(lastRunTs) && now - lastRunTs < MIN_RUN_INTERVAL_MS) {
    bot.status = "cooldown";
    bot.lastRunReason = "cooldown-active";
    bot.auditTrail.push({ at: new Date().toISOString(), action: "run_blocked", reason: "cooldown-active" });
    return bot;
  }
  bot.runs += 1;
  bot.lastRunAt = new Date().toISOString();
  const strictOnchain = options?.strictOnchain !== false;
  bot.status = bot.executionPlan.mode === "no-op" ? "idle" : strictOnchain ? "pending-onchain" : "executed-paper";
  bot.lastRunReason = bot.executionPlan.mode === "no-op" ? "no-op-signal" : strictOnchain ? "pending-onchain" : "paper-executed";
  bot.lastOnchainTx = null;
  const runMode = options?.runMode === "live" ? "live" : "paper";
  if (runMode === "live" && bot.executionPlan.mode !== "no-op" && typeof options.liveExecutor === "function") {
    try {
      const live = await options.liveExecutor(bot);
      bot.lastOnchainTx = live?.txHash || null;
      if (bot.lastOnchainTx) {
        bot.status = "executed-onchain";
        bot.lastRunReason = "onchain-executed";
      } else {
        bot.status = "onchain-failed";
        bot.lastRunReason = "onchain-tx-not-submitted";
        if (strictOnchain) throw new Error("onchain-tx-not-submitted");
      }
    } catch (e) {
      bot.status = "onchain-failed";
      bot.lastRunReason = "onchain-failed";
      bot.auditTrail.push({ at: new Date().toISOString(), action: "run_failed", reason: String(e?.message || e) });
      if (strictOnchain) throw e;
    }
  }
  bot.lastPaperResult = strictOnchain ? null : simulatePaperResult(bot, marketSnapshot);
  if (bot.lastPaperResult && !strictOnchain) {
    bot.grossPnlUsd = Number((bot.grossPnlUsd + Number(bot.lastPaperResult.realizedPnlUsd || 0)).toFixed(2));
    if (bot.lastPaperResult.outcome === "win") bot.wins += 1;
    if (bot.lastPaperResult.outcome === "loss") bot.losses += 1;
  }
  const mirrored = [];
  for (const f of bot.followers || []) {
    const alloc = Number(f.allocationUsd || 0);
    const pnlUsd = bot.lastPaperResult ? Number((alloc * Number(bot.lastPaperResult.realizedPnlPct || 0)).toFixed(2)) : 0;
    mirrored.push({
      at: bot.lastRunAt,
      followerId: f.followerId,
      allocationUsd: alloc,
      mirroredPnlUsd: pnlUsd,
      outcome: pnlUsd > 0 ? "win" : pnlUsd < 0 ? "loss" : "flat",
    });
  }
  bot.mirroredExecutions.unshift(...mirrored);
  if (bot.mirroredExecutions.length > 200) bot.mirroredExecutions.length = 200;
  bot.auditTrail.push({ at: bot.lastRunAt, action: "run", mode: `${bot.executionPlan.mode}:${runMode}`, reason: bot.lastRunReason, tx: bot.lastOnchainTx });
  return bot;
}

export function grantBotConsent(id, signer = "user") {
  const bot = bots.get(String(id));
  if (!bot) return null;
  bot.consent.granted = true;
  bot.consent.grantedAt = new Date().toISOString();
  bot.consent.signer = signer;
  if (bot.status === "awaiting-consent") bot.status = "ready";
  bot.auditTrail.push({ at: bot.consent.grantedAt, action: "consent_granted", signer });
  return bot;
}

export function botPerformanceSnapshot() {
  const rows = listBots();
  const totals = rows.reduce((acc, bot) => {
    acc.runs += Number(bot.runs || 0);
    acc.wins += Number(bot.wins || 0);
    acc.losses += Number(bot.losses || 0);
    acc.grossPnlUsd += Number(bot.grossPnlUsd || 0);
    return acc;
  }, { runs: 0, wins: 0, losses: 0, grossPnlUsd: 0 });
  const winRate = totals.runs > 0 ? totals.wins / totals.runs : 0;
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      ...totals,
      winRate,
    },
    bots: rows.map((b) => ({
      id: b.id,
      status: b.status,
      runs: b.runs,
      wins: b.wins,
      losses: b.losses,
      grossPnlUsd: b.grossPnlUsd,
      winRate: b.runs > 0 ? b.wins / b.runs : 0,
      lastRunAt: b.lastRunAt,
    })),
  };
}

export function followBot(id, followerId, allocationUsd = 0) {
  const bot = bots.get(String(id));
  if (!bot) return null;
  if (!followerId) return { error: "followerId-required" };
  const allocation = Math.max(0, Number(allocationUsd || 0));
  const next = (bot.followers || []).filter((f) => f.followerId !== followerId);
  next.push({ followerId, allocationUsd: allocation, followedAt: new Date().toISOString() });
  bot.followers = next;
  bot.auditTrail.push({ at: new Date().toISOString(), action: "follow", followerId, allocationUsd: allocation });
  return bot;
}

export function configureBotAutoRun(id, { enabled, mode, intervalSec }) {
  const bot = bots.get(String(id));
  if (!bot) return null;
  bot.autoRun = {
    enabled: Boolean(enabled),
    mode: "live",
    intervalSec: Math.max(10, Number(intervalSec || bot?.autoRun?.intervalSec || 30)),
    nextRunAt: enabled ? new Date(Date.now() + Math.max(10, Number(intervalSec || 30)) * 1000).toISOString() : null,
  };
  bot.auditTrail.push({ at: new Date().toISOString(), action: "autorun_config", autoRun: bot.autoRun });
  return bot;
}

export function exportBots() {
  return listBots();
}

export function importBots(rows = []) {
  bots.clear();
  let maxId = 0;
  for (const row of rows) {
    if (!row?.id) continue;
    bots.set(String(row.id), row);
    maxId = Math.max(maxId, Number(row.id) || 0);
  }
  nextBotId = maxId + 1;
}
