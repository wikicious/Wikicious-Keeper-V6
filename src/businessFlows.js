import { publicClient } from "./chain.js";
import {
  CONTRACTS,
  LAUNCHPAD_ABI,
  LAUNCHPOOL_ABI,
  LENDING_ABI,
  STAKING_ABI,
  PREDICTION_ABI,
  VAULT_ABI,
} from "./contracts.js";

async function safeRead(label, fn) {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error: error?.shortMessage || error?.message || String(error), label };
  }
}

export async function fetchBusinessOverview() {
  const [launchpad, launchPool, lending, staking, predictions, vault] = await Promise.all([
    safeRead("launchpad", fetchLaunchpad),
    safeRead("launchPool", fetchLaunchPool),
    safeRead("lending", fetchLending),
    safeRead("staking", fetchStaking),
    safeRead("predictions", fetchPredictions),
    safeRead("vault", fetchVault),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    launchpad,
    launchPool,
    lending,
    staking,
    predictions,
    vault,
  };
}

async function fetchLaunchpad() {
  const [saleCount, protocolFees] = await Promise.all([
    publicClient.readContract({ address: CONTRACTS.WikiLaunchpad, abi: LAUNCHPAD_ABI, functionName: "saleCount" }),
    publicClient.readContract({ address: CONTRACTS.WikiLaunchpad, abi: LAUNCHPAD_ABI, functionName: "protocolFees" }),
  ]);
  return { saleCount, protocolFees };
}

async function fetchLaunchPool() {
  const [poolCount, protocolFees] = await Promise.all([
    publicClient.readContract({ address: CONTRACTS.WikiLaunchPool, abi: LAUNCHPOOL_ABI, functionName: "poolCount" }),
    publicClient.readContract({ address: CONTRACTS.WikiLaunchPool, abi: LAUNCHPOOL_ABI, functionName: "protocolFees" }),
  ]);
  return { poolCount, protocolFees };
}

async function fetchLending() {
  const [marketCount, protocolReserves] = await Promise.all([
    publicClient.readContract({ address: CONTRACTS.WikiLending, abi: LENDING_ABI, functionName: "marketCount" }),
    publicClient.readContract({ address: CONTRACTS.WikiLending, abi: LENDING_ABI, functionName: "protocolReserves" }),
  ]);
  return { marketCount, protocolReserves };
}

async function fetchStaking() {
  const [totalLockedWIK, totalVeWIK, poolCount] = await Promise.all([
    publicClient.readContract({ address: CONTRACTS.WikiStaking, abi: STAKING_ABI, functionName: "totalLockedWIK" }),
    publicClient.readContract({ address: CONTRACTS.WikiStaking, abi: STAKING_ABI, functionName: "totalVeWIK" }),
    publicClient.readContract({ address: CONTRACTS.WikiStaking, abi: STAKING_ABI, functionName: "poolCount" }),
  ]);
  return { totalLockedWIK, totalVeWIK, poolCount };
}

async function fetchPredictions() {
  const [marketCount, totalVolume, protocolFees] = await Promise.all([
    publicClient.readContract({ address: CONTRACTS.WikiPredictionMarket, abi: PREDICTION_ABI, functionName: "marketCount" }),
    publicClient.readContract({ address: CONTRACTS.WikiPredictionMarket, abi: PREDICTION_ABI, functionName: "totalVolume" }),
    publicClient.readContract({ address: CONTRACTS.WikiPredictionMarket, abi: PREDICTION_ABI, functionName: "protocolFees" }),
  ]);
  return { marketCount, totalVolume, protocolFees };
}

async function fetchVault() {
  const [totalDeposits, totalMargin, protocolFees, isSolvent] = await Promise.all([
    publicClient.readContract({ address: CONTRACTS.WikiVault, abi: VAULT_ABI, functionName: "totalDeposits" }),
    publicClient.readContract({ address: CONTRACTS.WikiVault, abi: VAULT_ABI, functionName: "totalMargin" }),
    publicClient.readContract({ address: CONTRACTS.WikiVault, abi: VAULT_ABI, functionName: "protocolFees" }),
    publicClient.readContract({ address: CONTRACTS.WikiVault, abi: VAULT_ABI, functionName: "isSolvent" }),
  ]);
  return { totalDeposits, totalMargin, protocolFees, isSolvent };
}
