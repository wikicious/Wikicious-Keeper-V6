import { safeSend } from "./chain.js";
import { AUTOMATION_ABI } from "./contracts.js";
import { config } from "./config.js";
import { runtime } from "./state.js";

const TASKS = [
  { key: "adl", address: () => config.adlKeeperAddress, functionNames: ["executeDue", "execute", "rebalance"] },
  { key: "trailingStop", address: () => config.trailingStopAddress, functionNames: ["executeDue", "execute", "process"] },
  { key: "guaranteedStop", address: () => config.guaranteedStopAddress, functionNames: ["executeDue", "execute", "process"] },
  { key: "twamm", address: () => config.twammAddress, functionNames: ["execute", "executeDue", "process"] },
  { key: "autoCompounder", address: () => config.autoCompounderAddress, functionNames: ["harvest", "execute", "process"] },
  { key: "fundingArb", address: () => config.fundingArbVaultAddress, functionNames: ["rebalance", "execute", "process"] },
  { key: "gmxBackstop", address: () => config.gmxBackstopAddress, functionNames: ["rebalance", "execute", "process"] },
  { key: "idleYield", address: () => config.idleYieldRouterAddress, functionNames: ["rebalance", "execute", "process"] },
  { key: "telegramGateway", address: () => config.telegramGatewayAddress, functionNames: ["process", "execute"] },
];

export async function runAutomationOps() {
  const out = {};
  let configuredCount = 0;
  let sentCount = 0;
  for (const task of TASKS) {
    const address = task.address();
    if (!address) {
      out[task.key] = { configured: false, txHash: null };
      continue;
    }
    configuredCount += 1;
    let txHash = null;
    let usedFunction = null;
    for (const functionName of task.functionNames) {
      txHash = await safeSend({
        address,
        abi: AUTOMATION_ABI,
        functionName,
        args: [],
        label: `automation:${task.key}:${functionName}`,
      });
      if (txHash) {
        usedFunction = functionName;
        break;
      }
    }
    out[task.key] = { configured: true, txHash, usedFunction, attemptedFunctions: task.functionNames };
    if (txHash) sentCount += 1;
  }
  const runAt = new Date().toISOString();
  const summary = {
    at: runAt,
    configuredCount,
    sentCount,
    tasks: out,
  };
  runtime.automation = {
    ...(runtime.automation || {}),
    lastRunAt: runAt,
    tasks: out,
    lastSummary: summary,
    history: [summary, ...(runtime.automation?.history || [])].slice(0, 100),
  };
  return out;
}
