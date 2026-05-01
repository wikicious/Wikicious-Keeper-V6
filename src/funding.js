import { publicClient, safeSend } from "./chain.js";
import { CONTRACTS, PERP_ABI } from "./contracts.js";
import { config } from "./config.js";
import { runtime, pushError } from "./state.js";

let cachedInterval = 0n;

async function getFundingInterval() {
  if (cachedInterval > 0n) return cachedInterval;
  cachedInterval = await publicClient.readContract({
    address: CONTRACTS.WikiPerp,
    abi: PERP_ABI,
    functionName: "FUNDING_INTERVAL",
  });
  return cachedInterval;
}

async function getActiveMarketIds() {
  if (config.marketsToWatch.length > 0) return config.marketsToWatch.map(BigInt);
  const count = await publicClient.readContract({
    address: CONTRACTS.WikiPerp,
    abi: PERP_ABI,
    functionName: "marketCount",
  });
  return Array.from({ length: Number(count) }, (_, i) => BigInt(i));
}

export async function settleFundingTick() {
  const interval = await getFundingInterval();
  const ids = await getActiveMarketIds();
  const now = BigInt(Math.floor(Date.now() / 1000));

  for (const id of ids) {
    try {
      const m = await publicClient.readContract({
        address: CONTRACTS.WikiPerp,
        abi: PERP_ABI,
        functionName: "getMarket",
        args: [id],
      });
      if (!m.active) continue;
      const due = m.lastFundingTime + interval;
      if (now < due) continue;
      runtime.funding.attempts += 1;
      const hash = await safeSend({
        address: CONTRACTS.WikiPerp,
        abi: PERP_ABI,
        functionName: "settleFunding",
        args: [id],
        label: `settleFunding(${id})`,
      });
      if (hash) {
        runtime.funding.sent += 1;
        runtime.funding.lastSettledMarket = id.toString();
        runtime.funding.lastTx = hash;
      }
    } catch (e) {
      pushError("funding.settle", e);
      console.warn(`[funding] market ${id} read failed:`, e.shortMessage || e.message);
    }
  }
}
