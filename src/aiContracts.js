import { publicClient } from "./chain.js";
import {
  CONTRACTS,
  AGENTIC_DAO_ABI,
  AI_GUARDRAILS_ABI,
  KEEPER_SERVICE_ABI,
  ONCHAIN_ANALYTICS_ABI,
} from "./contracts.js";

function toObjMetrics(m) {
  if (!m) return null;
  if (Array.isArray(m)) {
    return {
      tvl: m[0],
      volume24h: m[1],
      activeUsers: m[2],
      feeBps: m[3],
      timestamp: m[4],
    };
  }
  return m;
}

export async function fetchAiContractsState() {
  const [guardrails, dao, keeperService, analytics] = await Promise.all([
    fetchGuardrails(),
    fetchDao(),
    fetchKeeperService(),
    fetchAnalytics(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    guardrails,
    agenticDao: dao,
    keeperService,
    analytics,
  };
}

async function fetchGuardrails() {
  try {
    const [defaultThreshold, policyCount, claimCount, totalPremiums, totalPayouts] = await Promise.all([
      publicClient.readContract({ address: CONTRACTS.WikiAIGuardrails, abi: AI_GUARDRAILS_ABI, functionName: "defaultThreshold" }),
      publicClient.readContract({ address: CONTRACTS.WikiAIGuardrails, abi: AI_GUARDRAILS_ABI, functionName: "policyCount" }),
      publicClient.readContract({ address: CONTRACTS.WikiAIGuardrails, abi: AI_GUARDRAILS_ABI, functionName: "claimCount" }),
      publicClient.readContract({ address: CONTRACTS.WikiAIGuardrails, abi: AI_GUARDRAILS_ABI, functionName: "totalPremiums" }),
      publicClient.readContract({ address: CONTRACTS.WikiAIGuardrails, abi: AI_GUARDRAILS_ABI, functionName: "totalPayouts" }),
    ]);
    return { ok: true, defaultThreshold, policyCount, claimCount, totalPremiums, totalPayouts };
  } catch (error) {
    return { ok: false, error: error?.shortMessage || error?.message || String(error) };
  }
}

async function fetchDao() {
  try {
    const [proposalCount, latestMetrics] = await Promise.all([
      publicClient.readContract({ address: CONTRACTS.WikiAgenticDAO, abi: AGENTIC_DAO_ABI, functionName: "proposalCount" }),
      publicClient.readContract({ address: CONTRACTS.WikiAgenticDAO, abi: AGENTIC_DAO_ABI, functionName: "latestMetrics" }),
    ]);
    return { ok: true, proposalCount, latestMetrics: toObjMetrics(latestMetrics) };
  } catch (error) {
    return { ok: false, error: error?.shortMessage || error?.message || String(error) };
  }
}

async function fetchKeeperService() {
  try {
    const [clientCount, totalRevenue, monthlyRunRate, keeperRewardPool] = await Promise.all([
      publicClient.readContract({ address: CONTRACTS.WikiKeeperService, abi: KEEPER_SERVICE_ABI, functionName: "clientCount" }),
      publicClient.readContract({ address: CONTRACTS.WikiKeeperService, abi: KEEPER_SERVICE_ABI, functionName: "totalRevenue" }),
      publicClient.readContract({ address: CONTRACTS.WikiKeeperService, abi: KEEPER_SERVICE_ABI, functionName: "monthlyRunRate" }),
      publicClient.readContract({ address: CONTRACTS.WikiKeeperService, abi: KEEPER_SERVICE_ABI, functionName: "keeperRewardPool" }),
    ]);
    return { ok: true, clientCount, totalRevenue, monthlyRunRate, keeperRewardPool };
  } catch (error) {
    return { ok: false, error: error?.shortMessage || error?.message || String(error) };
  }
}

async function fetchAnalytics() {
  try {
    const summary = await publicClient.readContract({
      address: CONTRACTS.WikiOnChainAnalytics,
      abi: ONCHAIN_ANALYTICS_ABI,
      functionName: "getProtocolSummary",
    });
    return { ok: true, summary };
  } catch (error) {
    return { ok: false, error: error?.shortMessage || error?.message || String(error) };
  }
}
