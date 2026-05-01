import "dotenv/config";

export const config = {
  privateKey: requireEnv("PRIVATE_KEY"),
  rpcUrl: requireEnv("RPC_URL"),
  rpcWsUrl: process.env.RPC_WS_URL || "",
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 4000),
  minLiquidationProfit: Number(process.env.MIN_LIQUIDATION_PROFIT || 1),
  dryRun: process.env.DRY_RUN === "true",
  discordWebhook: process.env.DISCORD_WEBHOOK_URL || "",
  marketsToWatch: (process.env.MARKETS_TO_WATCH || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),
  maxGasGwei: Number(process.env.MAX_GAS_PRICE_GWEI || 5),
  marketRefreshMs: Number(process.env.MARKET_REFRESH_MS || 5000),
  apiEnabled: process.env.API_ENABLED !== "false",
  apiHost: process.env.API_HOST || "0.0.0.0",
  apiPort: Number(process.env.API_PORT || 8787),
  apiKey: process.env.API_KEY || "",
  corsOrigin: process.env.API_CORS_ORIGIN || "*",
  liveExecutionEnabled: process.env.LIVE_EXECUTION_ENABLED === "true",
  onchainBotManager: process.env.ONCHAIN_BOT_MANAGER || "",
  liveMinConfidence: Number(process.env.LIVE_MIN_CONFIDENCE || 0.6),
  liveMaxVolatilityBps: Number(process.env.LIVE_MAX_VOLATILITY_BPS || 450),
  liveMaxNotionalUsd: Number(process.env.LIVE_MAX_NOTIONAL_USD || 10000),
  keeperAutoRegister: process.env.KEEPER_AUTO_REGISTER === "true",
  keeperAutoClaim: process.env.KEEPER_AUTO_CLAIM === "true",
  keeperMaintenanceEveryTicks: Number(process.env.KEEPER_MAINTENANCE_EVERY_TICKS || 30),
  positionsStateFile: process.env.POSITIONS_STATE_FILE || "./data/positions.json",
  gasPrivateKey: process.env.GAS_PRIVATE_KEY || "",
  maxPriorityFeeGwei: Number(process.env.MAX_PRIORITY_FEE_GWEI || 0.08),
  maxFeePerGasGwei: Number(process.env.MAX_FEE_PER_GAS_GWEI || 5),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  adlKeeperAddress: process.env.WIKI_ADL || "",
  trailingStopAddress: process.env.WIKI_TRAILING_STOP || "",
  guaranteedStopAddress: process.env.WIKI_GUARANTEED_STOP || "",
  twammAddress: process.env.WIKI_TWAMM || "",
  autoCompounderAddress: process.env.WIKI_AUTO_COMPOUNDER || "",
  fundingArbVaultAddress: process.env.WIKI_FUNDING_ARB_VAULT || "",
  gmxBackstopAddress: process.env.WIKI_GMX_BACKSTOP || "",
  idleYieldRouterAddress: process.env.WIKI_IDLE_YIELD_ROUTER || "",
  telegramGatewayAddress: process.env.WIKI_TELEGRAM_GATEWAY || "",
  circuitAutoReset: process.env.CIRCUIT_AUTO_RESET === "true",
  pythPriceUrl: process.env.PYTH_PRICE_URL || "",
  chainlinkPriceUrl: process.env.CHAINLINK_PRICE_URL || "",
};

function requireEnv(key) {
  const v = process.env[key];
  if (!v) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
  return v;
}
