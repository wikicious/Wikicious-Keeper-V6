import { publicClient, safeSend } from "./chain.js";
import { CONTRACTS, CONDITIONAL_ORDER_ABI } from "./contracts.js";
import { alert } from "./alerts.js";
import { runtime, pushError } from "./state.js";

const trackedOrderIds = new Set();

export async function bootstrapOrders() {
  try {
    const nextOrderId = await publicClient.readContract({
      address: CONTRACTS.WikiConditionalOrder,
      abi: CONDITIONAL_ORDER_ABI,
      functionName: "nextOrderId",
    });
    const maxToLoad = 1500n;
    const start = nextOrderId > maxToLoad ? nextOrderId - maxToLoad : 0n;
    for (let id = start; id < nextOrderId; id++) {
      trackedOrderIds.add(id.toString());
    }
    runtime.conditionalOrders.tracked = trackedOrderIds.size;
    await alert("info", "Conditional orders bootstrapped", `tracking=${trackedOrderIds.size}`);
  } catch (error) {
    pushError("orders.bootstrap", error);
  }
}

export async function watchOrders() {
  publicClient.watchContractEvent({
    address: CONTRACTS.WikiConditionalOrder,
    abi: CONDITIONAL_ORDER_ABI,
    eventName: "OrderCreated",
    onLogs: (logs) => {
      for (const log of logs) {
        const orderId = log.args?.orderId;
        if (orderId !== undefined) trackedOrderIds.add(orderId.toString());
      }
      runtime.conditionalOrders.tracked = trackedOrderIds.size;
    },
  });

  publicClient.watchContractEvent({
    address: CONTRACTS.WikiConditionalOrder,
    abi: CONDITIONAL_ORDER_ABI,
    eventName: "OrderCancelled",
    onLogs: (logs) => {
      logs.forEach((log) => trackedOrderIds.delete(log.args?.orderId?.toString()));
      runtime.conditionalOrders.tracked = trackedOrderIds.size;
    },
  });

  publicClient.watchContractEvent({
    address: CONTRACTS.WikiConditionalOrder,
    abi: CONDITIONAL_ORDER_ABI,
    eventName: "OrderTriggered",
    onLogs: (logs) => {
      logs.forEach((log) => trackedOrderIds.delete(log.args?.orderId?.toString()));
      runtime.conditionalOrders.tracked = trackedOrderIds.size;
    },
  });
}

export function getTrackedOrderIds() {
  return Array.from(trackedOrderIds).map((id) => BigInt(id));
}

export async function executeConditionalOrdersTick() {
  const ids = getTrackedOrderIds();
  if (ids.length === 0) return;

  const chunks = [];
  for (let i = 0; i < ids.length; i += 25) chunks.push(ids.slice(i, i + 25));

  for (const group of chunks) {
    try {
      const check = await safeSend({
        address: CONTRACTS.WikiConditionalOrder,
        abi: CONDITIONAL_ORDER_ABI,
        functionName: "batchCheck",
        args: [group],
        label: `batchCheck(${group.length})`,
      });
      if (check) runtime.conditionalOrders.lastTx = check;
    } catch (error) {
      pushError("orders.batchCheck", error);
    }

    for (const id of group) {
      runtime.conditionalOrders.attempts += 1;
      const hash = await safeSend({
        address: CONTRACTS.WikiConditionalOrder,
        abi: CONDITIONAL_ORDER_ABI,
        functionName: "checkAndExecute",
        args: [id],
        label: `checkAndExecute(${id})`,
      });
      if (hash) {
        runtime.conditionalOrders.sent += 1;
        runtime.conditionalOrders.lastExecutedOrderId = id.toString();
        runtime.conditionalOrders.lastTx = hash;
        trackedOrderIds.delete(id.toString());
        await alert("info", "Conditional order executed", `orderId=${id} tx=${hash}`);
      }
    }
  }

  runtime.conditionalOrders.tracked = trackedOrderIds.size;
}
