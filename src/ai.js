function toNum(v, fallback = 0) {
  if (v === null || v === undefined) return fallback;
  try {
    return Number(v);
  } catch {
    return fallback;
  }
}

async function llmSummary(insights, options = {}) {
  const apiKey = options?.openaiApiKey || "";
  if (!apiKey) return null;
  const top = (insights?.topIdeas || []).slice(0, 3).map((x) => ({
    symbol: x.symbol,
    action: x.action,
    confidence: Number(x.adjustedConfidence ?? x.confidence ?? 0),
    reason: x.reason,
  }));
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options?.openaiModel || "gpt-4.1-mini",
        input: `Summarize these trading opportunities in 2 short sentences, conservative tone: ${JSON.stringify(top)}`,
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.output_text || null;
  } catch {
    return null;
  }
}

async function llmChatReply({ prompt, conversation, advice, insights }, options = {}) {
  const apiKey = options?.openaiApiKey || "";
  if (!apiKey) return null;
  const compactIdeas = (insights?.topIdeas || []).slice(0, 5).map((x) => ({
    symbol: x.symbol,
    action: x.action,
    confidence: Number(x.adjustedConfidence ?? x.confidence ?? 0),
    regime: x.regime,
    volatilityBps: x.setup?.volatilityBps ?? null,
  }));
  const compactOpps = (advice?.opportunities || []).slice(0, 3).map((x) => ({
    symbol: x.symbol,
    action: x.action,
    confidence: Number(x.confidence || 0),
    regime: x?.risk?.regime || null,
    volatilityBps: x?.risk?.volatilityBps ?? null,
  }));
  const recentConversation = (conversation || []).slice(-8).map((m) => ({
    role: m?.role === "assistant" ? "assistant" : "user",
    text: String(m?.text || "").slice(0, 500),
  }));
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options?.openaiModel || "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content:
              "You are a conservative crypto trading copilot. Use only provided market data and conversation context. Keep reply under 180 words with bullet points: Thesis, Risk, Trigger, Invalidations. Do not promise returns.",
          },
          {
            role: "user",
            content: JSON.stringify({
              userPrompt: String(prompt || ""),
              recentConversation,
              opportunities: compactOpps,
              topIdeas: compactIdeas,
            }),
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.output_text || null;
  } catch {
    return null;
  }
}

function regimeFromFunding(fundingRate) {
  if (fundingRate > 25) return "overheated-longs";
  if (fundingRate < -25) return "overheated-shorts";
  return "balanced";
}

function detectPatterns({ breakoutUp, breakoutDown, momentumBps, volatilityBps, longBias }) {
  const patterns = [];
  if (breakoutUp && momentumBps > 120) patterns.push("breakout-continuation-up");
  if (breakoutDown && momentumBps < -120) patterns.push("breakout-continuation-down");
  if (Math.abs(momentumBps) < 90 && volatilityBps < 220) patterns.push("range-compression");
  if (Math.abs(longBias - 0.5) < 0.1 && Math.abs(momentumBps) > 180) patterns.push("positioning-divergence");
  return patterns;
}

export function buildStrategyInsights(snapshot) {
  const markets = snapshot?.markets || [];
  const ideas = markets.map((m) => {
    const longOi = toNum(m?.openInterest?.long);
    const shortOi = toNum(m?.openInterest?.short);
    const totalOi = Math.max(1, longOi + shortOi);
    const longBias = longOi / totalOi;
    const fundingRate = toNum(m?.funding?.fundingRate);
    const makerFee = toNum(m?.fees?.makerFeeBps);
    const takerFee = toNum(m?.fees?.takerFeeBps);
    const momentumBps = toNum(m?.signals?.momentumBps);
    const volatilityBps = toNum(m?.signals?.volatilityBps);
    const breakoutUp = Boolean(m?.signals?.breakoutUp);
    const breakoutDown = Boolean(m?.signals?.breakoutDown);
    const patterns = detectPatterns({ breakoutUp, breakoutDown, momentumBps, volatilityBps, longBias });

    let action = "wait";
    const reasons = [];

    if (breakoutUp && momentumBps > 120 && fundingRate <= 40) {
      action = "long-bias";
      reasons.push("breakout-up");
    }
    if (breakoutDown && momentumBps < -120 && fundingRate >= -40) {
      action = "short-bias";
      reasons.push("breakout-down");
    }
    if (fundingRate > 25 && longBias > 0.6) action = "short-bias";
    if (fundingRate < -25 && longBias < 0.4) action = "long-bias";
    if (Math.abs(fundingRate) < 10 && takerFee <= 20) action = "market-make";

    if (volatilityBps > 450 && action !== "market-make") {
      action = "wait";
      reasons.push("risk-high-volatility");
    }

    const baseConfidence = 0.42
      + Math.min(0.22, Math.abs(fundingRate) / 300)
      + Math.min(0.18, Math.abs(momentumBps) / 2000)
      + (breakoutUp || breakoutDown ? 0.09 : 0);

    return {
      marketIndex: m.marketIndex,
      symbol: m.symbol,
      source: m.source || "onchain",
      action,
      confidence: Math.min(0.97, baseConfidence),
      regime: regimeFromFunding(fundingRate),
      costProfile: { makerFeeBps: makerFee, takerFeeBps: takerFee },
      setup: {
        momentumBps,
        volatilityBps,
        breakoutUp,
        breakoutDown,
        patterns,
      },
      reason: `funding=${fundingRate}, longBias=${longBias.toFixed(2)}, takerFee=${takerFee}, momentumBps=${momentumBps}, volatilityBps=${volatilityBps}`,
      tags: [...new Set([...reasons, ...patterns])],
    };
  });

  ideas.sort((a, b) => b.confidence - a.confidence);

  return {
    generatedAt: new Date().toISOString(),
    model: "rules-v2-patterns",
    totalMarkets: markets.length,
    topIdeas: ideas.slice(0, 5),
  };
}

export function tuneIdeasForPrompt(ideas, prompt = "") {
  const text = String(prompt || "").toLowerCase();
  const wantsBreakout = text.includes("breakout");
  const wantsScalp = text.includes("scalp") || text.includes("intraday");
  const wantsConservative = text.includes("low risk") || text.includes("conservative");
  const wantsMarketMaking = text.includes("market make");

  return (ideas || [])
    .map((idea) => {
      let score = Number(idea.confidence || 0);
      if (wantsBreakout && idea.setup?.patterns?.includes("breakout-continuation-up")) score += 0.08;
      if (wantsBreakout && idea.setup?.patterns?.includes("breakout-continuation-down")) score += 0.08;
      if (wantsScalp && Number(idea.setup?.volatilityBps || 0) < 300) score += 0.04;
      if (wantsConservative && Number(idea.setup?.volatilityBps || 0) > 350) score -= 0.12;
      if (wantsMarketMaking && idea.action === "market-make") score += 0.18;
      return { ...idea, adjustedConfidence: Math.max(0, Math.min(0.99, score)) };
    })
    .sort((a, b) => b.adjustedConfidence - a.adjustedConfidence);
}

export function buildTradeAdvice(insights, options = {}) {
  const minConfidence = Number(options.minConfidence || 0.55);
  const top = (insights?.topIdeas || [])
    .filter((x) => Number(x.adjustedConfidence ?? x.confidence ?? 0) >= minConfidence && x.action !== "wait")
    .slice(0, 3);
  return {
    generatedAt: new Date().toISOString(),
    summary: top.length
      ? `Found ${top.length} high-confidence opportunities.`
      : "No strong opportunities right now. Wait for cleaner setups.",
    opportunities: top.map((x) => ({
      marketIndex: x.marketIndex,
      symbol: x.symbol,
      source: x.source || "onchain",
      action: x.action,
      confidence: Number(x.adjustedConfidence ?? x.confidence ?? 0),
      why: x.reason,
      patterns: x.setup?.patterns || [],
      risk: {
        volatilityBps: x.setup?.volatilityBps ?? null,
        regime: x.regime,
      },
    })),
  };
}

export async function buildTradeAdviceWithLlm(insights, options = {}) {
  const base = buildTradeAdvice(insights, options);
  const llm = await llmSummary(insights, options);
  return {
    ...base,
    model: llm ? "openai-assisted" : "rules-v2-patterns",
    llmSummary: llm,
  };
}

export async function buildChatReplyWithLlm({ prompt, conversation, advice, insights }, options = {}) {
  const llm = await llmChatReply({ prompt, conversation, advice, insights }, options);
  if (llm) return llm;
  const top = (advice?.opportunities || [])
    .slice(0, 3)
    .map((o) => `${o.symbol} ${o.action} (${Math.round(Number(o.confidence || 0) * 100)}%)`)
    .join(" • ");
  return `${advice?.summary || "No clear setup yet."}${top ? ` Top: ${top}` : ""}`;
}

export function buildTradeDecision(advice, options = {}) {
  const maxVolatilityBps = Number(options.maxVolatilityBps || 420);
  const minConfidence = Number(options.minConfidence || 0.6);
  const openPositions = Math.max(0, Number(options.openPositions || 0));
  const generatedAt = new Date().toISOString();
  const opportunities = Array.isArray(advice?.opportunities) ? advice.opportunities : [];
  const best = opportunities[0] || null;
  if (!best) {
    return {
      allowTrade: false,
      reason: "No qualifying opportunities.",
      verdictLevel: "red",
      riskFlags: ["no-opportunities"],
      constraints: {
        maxPositionUsd: 0,
        stopLossPct: 0,
      },
      gates: {
        minConfidence,
        maxVolatilityBps,
      },
      generatedAt,
      portfolioContext: {
        openPositions,
        positionScale: 1,
      },
    };
  }
  const riskFlags = [];
  const vol = Number(best?.risk?.volatilityBps ?? 0);
  const conf = Number(best?.confidence ?? 0);
  if (vol > maxVolatilityBps) riskFlags.push("volatility-too-high");
  if (conf < minConfidence) riskFlags.push("confidence-too-low");
  const allowTrade = riskFlags.length === 0;
  const stopLossPct = vol > 300 ? 0.8 : 1.2;
  const positionScale = openPositions >= 5 ? 0.4 : openPositions >= 3 ? 0.6 : openPositions >= 1 ? 0.8 : 1;
  const maxPositionUsd = allowTrade ? Math.round((conf > 0.8 ? 2000 : 1200) * positionScale) : 0;
  const verdictLevel = !allowTrade ? "red" : conf >= 0.8 ? "green" : "yellow";
  return {
    allowTrade,
    reason: allowTrade ? "Risk gates passed." : "Risk gates blocked this setup.",
    verdictLevel,
    riskFlags,
    constraints: {
      maxPositionUsd,
      stopLossPct,
    },
    gates: {
      minConfidence,
      maxVolatilityBps,
    },
    generatedAt,
    candidate: {
      symbol: best.symbol,
      action: best.action,
      confidence: conf,
      volatilityBps: vol,
    },
    portfolioContext: {
      openPositions,
      positionScale,
    },
  };
}
