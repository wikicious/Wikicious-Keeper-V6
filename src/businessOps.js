import { safeSend } from "./chain.js";
import { AUTOMATION_ABI } from "./contracts.js";
import { config } from "./config.js";

const FLOWS = {
  adl: { address: () => config.adlKeeperAddress, functions: ["executeDue", "execute", "rebalance"] },
  trailingStop: { address: () => config.trailingStopAddress, functions: ["executeDue", "execute", "process"] },
  guaranteedStop: { address: () => config.guaranteedStopAddress, functions: ["executeDue", "execute", "process"] },
  twamm: { address: () => config.twammAddress, functions: ["execute", "executeDue", "process"] },
  autoCompounder: { address: () => config.autoCompounderAddress, functions: ["harvest", "execute", "process"] },
  fundingArb: { address: () => config.fundingArbVaultAddress, functions: ["rebalance", "execute", "process"] },
  gmxBackstop: { address: () => config.gmxBackstopAddress, functions: ["rebalance", "execute", "process"] },
  idleYield: { address: () => config.idleYieldRouterAddress, functions: ["rebalance", "execute", "process"] },
  telegramGateway: { address: () => config.telegramGatewayAddress, functions: ["process", "execute"] },
};

export function listBusinessFlowKeys() {
  return Object.keys(FLOWS);
}

export function flowConfig(key) {
  return FLOWS[key] || null;
}

export async function executeBusinessFlow(key) {
  const row = flowConfig(key);
  if (!row) return { ok: false, error: "unknown-flow", key };
  const address = row.address();
  if (!address) return { ok: false, error: "flow-not-configured", key };

  for (const fn of row.functions) {
    const txHash = await safeSend({
      address,
      abi: AUTOMATION_ABI,
      functionName: fn,
      args: [],
      label: `businessFlow:${key}:${fn}`,
    });
    if (txHash) return { ok: true, key, address, functionName: fn, txHash };
  }
  return { ok: false, key, address, error: "no-transaction-submitted", attemptedFunctions: row.functions };
}

export async function executeAllBusinessFlows() {
  const out = {};
  for (const key of listBusinessFlowKeys()) {
    // eslint-disable-next-line no-await-in-loop
    out[key] = await executeBusinessFlow(key);
  }
  return out;
}
