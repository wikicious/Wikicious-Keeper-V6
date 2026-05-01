import { account, publicClient, safeSend } from "./chain.js";
import { CONTRACTS, KEEPERS_ABI, KEEPER_SERVICE_ABI } from "./contracts.js";
import { runtime, pushError } from "./state.js";

export async function runKeeperMaintenance({ autoRegister = false, autoClaim = false } = {}) {
  const result = {
    checkedAt: new Date().toISOString(),
    autoRegister: Boolean(autoRegister),
    autoClaim: Boolean(autoClaim),
    registerTx: null,
    claimTx: null,
    isKeeper: null,
  };
  try {
    result.isKeeper = await publicClient.readContract({
      address: CONTRACTS.WikiKeeperRegistry,
      abi: KEEPERS_ABI,
      functionName: "isKeeper",
      args: [account.address],
    });
  } catch (e) {
    pushError("keeper.maintenance.isKeeper", e);
  }

  if (autoRegister && result.isKeeper === false) {
    result.registerTx = await safeSend({
      address: CONTRACTS.WikiKeeperRegistry,
      abi: KEEPERS_ABI,
      functionName: "register",
      args: [],
      label: "keeperRegister",
    });
    if (result.registerTx) runtime.keeper.registeredAt = new Date().toISOString();
  }

  if (autoClaim) {
    result.claimTx = await safeSend({
      address: CONTRACTS.WikiKeeperService,
      abi: KEEPER_SERVICE_ABI,
      functionName: "claim",
      args: [],
      label: "keeperClaim",
    });
    if (result.claimTx) runtime.keeper.lastClaimTx = result.claimTx;
  }
  runtime.keeper.lastMaintenanceAt = result.checkedAt;
  runtime.keeper.isKeeper = result.isKeeper;
  return result;
}

