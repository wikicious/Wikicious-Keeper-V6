import { publicClient, safeSend } from "./chain.js";
import { CONTRACTS, LIQUIDATOR_ABI, PERP_ABI } from "./contracts.js";
import { alert } from "./alerts.js";
import { runtime, pushError } from "./state.js";
import { config } from "./config.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const seenPositions = new Set();
let dirty = false;

async function loadSeenPositions() {
  try {
    const raw = await readFile(config.positionsStateFile, "utf8");
    const parsed = JSON.parse(raw);
    for (const id of parsed?.positions || []) seenPositions.add(String(id));
  } catch {}
  runtime.liquidations.watchedPositions = seenPositions.size;
}

async function persistSeenPositions() {
  if (!dirty) return;
  try {
    await mkdir(dirname(config.positionsStateFile), { recursive: true });
    await writeFile(
      config.positionsStateFile,
      JSON.stringify({ updatedAt: new Date().toISOString(), positions: Array.from(seenPositions) }, null, 2),
      "utf8",
    );
    dirty = false;
  } catch (error) {
    pushError("liquidator.persist", error);
  }
}

async function bootstrapOpenPositions(lookbackBlocks = 50_000n) {
  try {
    const latest = await publicClient.getBlockNumber();
    const fromBlock = latest > lookbackBlocks ? latest - lookbackBlocks : 0n;

    const [opened, closed, liquidated] = await Promise.all([
      publicClient.getLogs({
        address: CONTRACTS.WikiPerp,
        event: PERP_ABI.find((x) => x.type === "event" && x.name === "PositionOpened"),
        fromBlock,
        toBlock: "latest",
      }),
      publicClient.getLogs({
        address: CONTRACTS.WikiPerp,
        event: PERP_ABI.find((x) => x.type === "event" && x.name === "PositionClosed"),
        fromBlock,
        toBlock: "latest",
      }),
      publicClient.getLogs({
        address: CONTRACTS.WikiPerp,
        event: PERP_ABI.find((x) => x.type === "event" && x.name === "PositionLiquidated"),
        fromBlock,
        toBlock: "latest",
      }),
    ]);

    for (const log of opened) {
      if (log.args?.posId !== undefined) {
        seenPositions.add(log.args.posId.toString());
        dirty = true;
      }
    }
    for (const log of closed) {
      if (seenPositions.delete(log.args?.posId?.toString())) dirty = true;
    }
    for (const log of liquidated) {
      if (seenPositions.delete(log.args?.posId?.toString())) dirty = true;
    }
    runtime.liquidations.watchedPositions = seenPositions.size;
    await persistSeenPositions();
  } catch (error) {
    pushError("liquidator.bootstrap", error);
  }
}

/** Watch PositionOpened events and add posIds to the candidate set. */
export async function watchPositions() {
  await loadSeenPositions();
  await bootstrapOpenPositions();
  const fromBlock = await publicClient.getBlockNumber();
  publicClient.watchContractEvent({
    address: CONTRACTS.WikiPerp,
    abi: PERP_ABI,
    eventName: "PositionOpened",
    onLogs: (logs) => {
      for (const log of logs) {
        const posId = log.args?.posId;
        if (posId !== undefined) {
          seenPositions.add(posId.toString());
          dirty = true;
        }
      }
      runtime.liquidations.watchedPositions = seenPositions.size;
      persistSeenPositions();
    },
  });
  publicClient.watchContractEvent({
    address: CONTRACTS.WikiPerp,
    abi: PERP_ABI,
    eventName: "PositionClosed",
    onLogs: (logs) => {
      logs.forEach((l) => {
        if (seenPositions.delete(l.args?.posId?.toString())) dirty = true;
      });
      runtime.liquidations.watchedPositions = seenPositions.size;
      persistSeenPositions();
    },
  });
  publicClient.watchContractEvent({
    address: CONTRACTS.WikiPerp,
    abi: PERP_ABI,
    eventName: "PositionLiquidated",
    onLogs: (logs) => {
      logs.forEach((l) => {
        if (seenPositions.delete(l.args?.posId?.toString())) dirty = true;
      });
      runtime.liquidations.watchedPositions = seenPositions.size;
      persistSeenPositions();
    },
  });
  console.log(`[liq] watching PositionOpened from block ${fromBlock}`);
}

export function getTrackedPositions() {
  return Array.from(seenPositions).map((id) => BigInt(id));
}

/** Scan known positions, liquidate any where isLiquidatable() returns true. */
export async function scanForLiquidations() {
  const ids = Array.from(seenPositions);
  if (ids.length === 0) return;

  const results = await publicClient.multicall({
    contracts: ids.map((id) => ({
      address: CONTRACTS.WikiLiquidator,
      abi: LIQUIDATOR_ABI,
      functionName: "isLiquidatable",
      args: [BigInt(id)],
    })),
    allowFailure: true,
  });

  for (let i = 0; i < ids.length; i++) {
    const r = results[i];
    if (r.status !== "success" || r.result !== true) continue;
    const posId = ids[i];
    runtime.liquidations.attempts += 1;
    const hash = await safeSend({
      address: CONTRACTS.WikiLiquidator,
      abi: LIQUIDATOR_ABI,
      functionName: "liquidate",
      args: [BigInt(posId)],
      label: `liquidate(${posId})`,
    });
    if (hash) {
      runtime.liquidations.sent += 1;
      runtime.liquidations.lastTx = hash;
      await alert("info", "Liquidation sent", `posId=${posId} tx=${hash}`);
    }
  }
}
