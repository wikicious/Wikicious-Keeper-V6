import { publicClient, safeSend, account } from "./chain.js";
import { BOT_MANAGER_ABI } from "./contracts.js";
import { config } from "./config.js";

function managerAddress() {
  return config.onchainBotManager || "";
}

export function onchainBotsEnabled() {
  return Boolean(managerAddress());
}

export async function fetchOnchainBots(limit = 20) {
  if (!onchainBotsEnabled()) return { enabled: false, bots: [] };
  const address = managerAddress();
  const count = await publicClient.readContract({
    address,
    abi: BOT_MANAGER_ABI,
    functionName: "botCount",
  });
  const max = Math.min(Number(count), Math.max(0, Number(limit || 20)));
  const bots = [];
  for (let i = Math.max(0, Number(count) - max); i < Number(count); i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const row = await publicClient.readContract({
      address,
      abi: BOT_MANAGER_ABI,
      functionName: "getBot",
      args: [BigInt(i)],
    });
    bots.push({ id: i, ...row });
  }
  return { enabled: true, address, count: Number(count), bots };
}

export async function registerOnchainBot({ owner, marketId, isLong, maxNotional }) {
  if (!onchainBotsEnabled()) return null;
  const address = managerAddress();
  const txHash = await safeSend({
    address,
    abi: BOT_MANAGER_ABI,
    functionName: "registerBot",
    args: [owner || account.address, marketId, Boolean(isLong), BigInt(Math.max(0, Number(maxNotional || 0)))],
    label: "registerOnchainBot",
  });
  return { txHash };
}

export async function setOnchainBotActive({ botId, active }) {
  if (!onchainBotsEnabled()) return null;
  const address = managerAddress();
  const txHash = await safeSend({
    address,
    abi: BOT_MANAGER_ABI,
    functionName: "setBotActive",
    args: [BigInt(botId), Boolean(active)],
    label: "setOnchainBotActive",
  });
  return { txHash };
}

