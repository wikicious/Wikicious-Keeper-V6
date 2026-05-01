import { publicClient } from "./chain.js";
import { CONTRACTS, CIRCUIT_BREAKER_ABI } from "./contracts.js";
import { config } from "./config.js";
import { alert } from "./alerts.js";
import { watchPositions, scanForLiquidations } from "./liquidator.js";
import { settleFundingTick } from "./funding.js";
import { bootstrapOrders, executeConditionalOrdersTick, watchOrders } from "./orders.js";
import { runtime, pushError } from "./state.js";
import { startBackendServer } from "./backend.js";
import { refreshMarketSnapshot } from "./marketData.js";
import { runKeeperMaintenance } from "./keeperOps.js";
import { runAutomationOps } from "./automationOps.js";
import { safeSend } from "./chain.js";

let circuitTripped = false;

async function checkCircuit() {
  try {
    const t = await publicClient.readContract({
      address: CONTRACTS.WikiCircuitBreaker,
      abi: CIRCUIT_BREAKER_ABI,
      functionName: "isTripped",
    });
    if (t && !circuitTripped) {
      circuitTripped = true;
      await alert("error", "Circuit breaker TRIPPED", "Halting writes until reset.");
      if (config.circuitAutoReset) {
        const tx = await safeSend({
          address: CONTRACTS.WikiCircuitBreaker,
          abi: CIRCUIT_BREAKER_ABI,
          functionName: "reset",
          args: [],
          label: "circuitReset",
        });
        if (tx) await alert("warn", "Circuit breaker reset tx sent", tx);
      }
    } else if (!t && circuitTripped) {
      circuitTripped = false;
      await alert("info", "Circuit breaker reset", "Resuming writes.");
    }
  } catch {
    // Older WikiCircuitBreaker may not expose isTripped — silently ignore.
  }
}

async function tick() {
  await checkCircuit();
  runtime.lastTickAt = new Date().toISOString();
  runtime.tickCount += 1;
  if (runtime.tickCount % Math.max(1, Number(config.keeperMaintenanceEveryTicks || 30)) === 0) {
    await runKeeperMaintenance({
      autoRegister: config.keeperAutoRegister,
      autoClaim: config.keeperAutoClaim,
    });
  }
  if (runtime.tickCount % 5 === 0) {
    await runAutomationOps();
  }
  if (circuitTripped) return;

  const results = await Promise.allSettled([
    refreshMarketSnapshot(),
    scanForLiquidations(),
    settleFundingTick(),
    executeConditionalOrdersTick(),
  ]);

  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const scope = ["markets", "liquidations", "funding", "conditionalOrders"][i] || "tick";
      pushError(scope, r.reason);
    }
  });
}

async function setupWatchers() {
  const setupResults = await Promise.allSettled([
    watchPositions(),
    bootstrapOrders(),
    watchOrders(),
  ]);
  for (const [idx, result] of setupResults.entries()) {
    if (result.status === "rejected") {
      const scope = ["watchPositions", "bootstrapOrders", "watchOrders"][idx];
      pushError(`setup.${scope}`, result.reason);
      await alert("warn", `Setup failed: ${scope}`, "Keeper will keep retrying in loop.");
    }
  }
}

async function main() {
  await alert("info", "Wikicious keeper starting", `dryRun=${config.dryRun} markets=${config.marketsToWatch.join(",") || "all"}`);
  startBackendServer();
  await setupWatchers();
  await refreshMarketSnapshot(true);

  while (true) {
    const t0 = Date.now();
    try {
      if (runtime.tickCount > 0 && runtime.tickCount % 300 === 0) {
        await setupWatchers();
      }
      await tick();
    } catch (e) {
      pushError("tick", e);
      await alert("error", "tick crashed", e?.message || String(e));
    }
    const elapsed = Date.now() - t0;
    const wait = Math.max(0, config.pollIntervalMs - elapsed);
    await new Promise((r) => setTimeout(r, wait));
  }
}

process.on("uncaughtException", (e) => {
  pushError("uncaughtException", e);
  alert("error", "uncaughtException", e.stack || e.message);
});
process.on("unhandledRejection", (e) => {
  pushError("unhandledRejection", e);
  alert("error", "unhandledRejection", String(e));
});

main().catch((e) => {
  pushError("main", e);
  alert("error", "main crashed", e?.stack || e?.message || String(e));
});
