import { buildStrategyInsights, tuneIdeasForPrompt } from "./ai.js";

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function confidenceToTier(conf) {
  if (conf >= 0.8) return "high";
  if (conf >= 0.65) return "medium";
  return "low";
}

function buildSizingPlan(maxNotionalUsd, selectedIdea) {
  const confidence = Number(selectedIdea?.adjustedConfidence ?? selectedIdea?.confidence ?? 0);
  const volatilityBps = Number(selectedIdea?.setup?.volatilityBps || 0);
  const confidenceFactor = Math.max(0.2, Math.min(1, confidence));
  const volPenalty = Math.max(0.3, 1 - Math.min(0.6, volatilityBps / 1000));
  const scaler = Number((confidenceFactor * volPenalty).toFixed(3));
  const recommendedNotionalUsd = Math.max(100, Math.round(maxNotionalUsd * scaler));
  return {
    confidenceTier: confidenceToTier(confidence),
    confidence,
    volatilityBps,
    scaler,
    recommendedNotionalUsd,
  };
}

export function compileStrategyIntent({ prompt, risk = {} }, marketSnapshot, aiContractsState, businessOverview) {
  const rawInsights = buildStrategyInsights(marketSnapshot);
  const tunedIdeas = tuneIdeasForPrompt(rawInsights.topIdeas || [], prompt);
  const insights = { ...rawInsights, topIdeas: tunedIdeas };
  const top = tunedIdeas?.[0] || null;
  const maxDrawdownBps = clampInt(risk.maxDrawdownBps ?? 1200, 100, 5000, 1200);
  const maxNotionalUsd = clampInt(risk.maxNotionalUsd ?? 5000, 100, 1_000_000, 5000);
  const minConfidence = clampInt(risk.minConfidenceBps ?? 5500, 0, 10000, 5500) / 10000;
  const maxIdeas = clampInt(risk.maxIdeas ?? 5, 1, 20, 5);
  const opportunities = (insights.topIdeas || [])
    .filter((i) => i.action !== "wait" && Number(i.adjustedConfidence ?? i.confidence ?? 0) >= minConfidence)
    .slice(0, maxIdeas);
  const sizing = buildSizingPlan(maxNotionalUsd, top);
  const warnings = [];
  if (!aiContractsState?.guardrails?.ok) warnings.push("ai-guardrails-unavailable");
  if (!businessOverview?.generatedAt) warnings.push("business-overview-stale");
  if (!marketSnapshot?.updatedAt) warnings.push("market-snapshot-empty");

  return {
    generatedAt: new Date().toISOString(),
    prompt: prompt || "",
    model: "rules-v2-patterns",
    constraints: {
      maxDrawdownBps,
      maxNotionalUsd,
      minConfidence,
      maxIdeas,
      allowedActions: ["long-bias", "short-bias", "market-make", "wait"],
      requireUserConsent: true,
    },
    opportunities,
    selectedIdea: top,
    sizing,
    warnings,
    userConsent: {
      required: true,
      granted: false,
      grantedAt: null,
    },
    executionChecklist: [
      "Confirm market regime aligns with signal direction.",
      "Confirm confidence is above configured threshold.",
      "Verify gas and slippage are acceptable.",
      "Approve execution only after wallet/account review.",
    ],
    sources: {
      aiContractsOk: Boolean(aiContractsState?.guardrails?.ok),
      businessOverviewAt: businessOverview?.generatedAt || null,
      marketSnapshotAt: marketSnapshot?.updatedAt || null,
    },
  };
}

export function buildExecutionPlan(compiled) {
  if (!compiled?.selectedIdea) {
    return { mode: "no-op", reason: "No actionable idea", txPlan: [] };
  }

  const action = compiled.selectedIdea.action;
  const marketIndex = compiled.selectedIdea.marketIndex;
  const volatilityBps = Number(compiled?.selectedIdea?.setup?.volatilityBps || 0);
  const targetBps = Math.max(60, Math.min(800, Math.round(volatilityBps * 1.4)));
  const stopLossBps = Math.max(40, Math.min(500, Math.round(targetBps * 0.65)));
  if (action === "wait") return { mode: "no-op", reason: "Signal is wait", txPlan: [] };

  return {
    mode: "onchain-plan",
    reason: "Prepared for real on-chain execution after user sign-off",
    requiresConsent: true,
    sizing: compiled?.sizing || null,
    riskPlan: {
      stopLossBps,
      takeProfitBps: targetBps,
      confidence: Number(compiled.selectedIdea.adjustedConfidence ?? compiled.selectedIdea.confidence ?? 0),
      confidenceTier: compiled?.sizing?.confidenceTier || "low",
    },
    txPlan: [
      {
        contract: "WikiConditionalOrder",
        functionName: "createOrder",
        argsTemplate: {
          marketIndex,
          side: action === "long-bias" ? "long" : "short",
          maxNotionalUsd: compiled.constraints.maxNotionalUsd,
          maxDrawdownBps: compiled.constraints.maxDrawdownBps,
        },
      },
    ],
  };
}
