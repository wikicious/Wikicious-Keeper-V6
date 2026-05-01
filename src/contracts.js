// Wikicious V6 — addresses + minimal ABIs needed by the keeper.
// Keep this in sync with src/lib/contracts.ts in the frontend repo.

export const CONTRACTS = {
  WikiPerp: "0x723f653a3DEFC45FB934BBF81f1411883a977468",
  WikiLiquidator: "0x1fCe4e7c16386af492b6275DDDEcA747f6559a65",
  WikiOracle: "0xA99583D3cd272F95b8f08b32297f072f5164D0DC",
  WikiKeeperRegistry: "0x27F57e95cca2b4c88a50490212a2cCDDb3168e34",
  WikiCircuitBreaker: "0xa24D3Dc833566A59e7130bf42a8C4f1908A0b4ae",
  WikiConditionalOrder: "0xCBed48F05dAF5db381503e43EB04d62D7ca40Ba7",
  WikiAIGuardrails: "0xf41e465d8cd2741cf9aCa2b7f988ccAB5B8d03E7",
  WikiAgenticDAO: "0x8d451ADbea9F109b5F072C477a8AA03896931074",
  WikiKeeperService: "0xFdD18D26980Ee49C1f33588C381d90E6bD9846c2",
  WikiOnChainAnalytics: "0x376E30fd99CBF35B7486FCC1b183cD22271099fc",
  WikiLaunchpad: "0x42DB4776FFB45f2cc5663407e7953935f63fd40E",
  WikiLaunchPool: "0xD2b9d006744dE5d9821b0062bFbc5A1c6e6B80d4",
  WikiLending: "0x74635CFa33EEAe220367fF10C598e098a29e9246",
  WikiStaking: "0xDD551D705fAbD4380D2C95F7345b671cE3310bd2",
  WikiPredictionMarket: "0x650ea9441d228F03D52179AB5BA35A446b8BF01B",
  WikiVault: "0x4533E181FdF5b0C66e0816992F38c23d57e42Df8",
};

export const PERP_ABI = [
  { type: "function", name: "marketCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "getMarket",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{
      type: "tuple",
      components: [
        { name: "marketId", type: "bytes32" },
        { name: "symbol", type: "string" },
        { name: "maxLeverage", type: "uint256" },
        { name: "makerFeeBps", type: "uint256" },
        { name: "takerFeeBps", type: "uint256" },
        { name: "maintenanceMarginBps", type: "uint256" },
        { name: "maxOpenInterestLong", type: "uint256" },
        { name: "maxOpenInterestShort", type: "uint256" },
        { name: "openInterestLong", type: "uint256" },
        { name: "openInterestShort", type: "uint256" },
        { name: "maxPositionSizePerUser", type: "uint256" },
        { name: "fundingRate", type: "int256" },
        { name: "lastFundingTime", type: "uint256" },
        { name: "cumulativeFundingLong", type: "uint256" },
        { name: "cumulativeFundingShort", type: "uint256" },
        { name: "active", type: "bool" },
        { name: "lastOIUpdateBlock", type: "uint256" },
        { name: "oiChangesThisBlock", type: "uint256" },
      ],
    }],
  },
  { type: "function", name: "FUNDING_INTERVAL", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "settleFunding",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketIdx", type: "uint256" }],
    outputs: [],
  },
  { type: "event", name: "PositionOpened", inputs: [{ name: "posId", type: "uint256", indexed: true }, { name: "trader", type: "address", indexed: true }, { name: "isLong", type: "bool", indexed: false }, { name: "size", type: "uint256", indexed: false }, { name: "price", type: "uint256", indexed: false }] },
  { type: "event", name: "PositionClosed", inputs: [{ name: "posId", type: "uint256", indexed: true }, { name: "trader", type: "address", indexed: true }, { name: "pnl", type: "int256", indexed: false }, { name: "closePrice", type: "uint256", indexed: false }] },
  { type: "event", name: "PositionLiquidated", inputs: [{ name: "posId", type: "uint256", indexed: true }, { name: "trader", type: "address", indexed: true }, { name: "liquidator", type: "address", indexed: false }, { name: "price", type: "uint256", indexed: false }] },
];

export const LIQUIDATOR_ABI = [
  { type: "function", name: "liquidate", stateMutability: "nonpayable", inputs: [{ name: "posId", type: "uint256" }], outputs: [] },
  { type: "function", name: "isLiquidatable", stateMutability: "view", inputs: [{ name: "posId", type: "uint256" }], outputs: [{ type: "bool" }] },
];

export const CONDITIONAL_ORDER_ABI = [
  { type: "function", name: "nextOrderId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "createOrder",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "owner", type: "address" },
          { name: "marketId", type: "bytes32" },
          { name: "collateral", type: "uint256" },
          { name: "size", type: "uint256" },
          { name: "tpPrice", type: "uint256" },
          { name: "slPrice", type: "uint256" },
          { name: "triggerPrice", type: "uint256" },
          { name: "triggerType", type: "uint8" },
          { name: "isLong", type: "bool" },
          { name: "isReduceOnly", type: "bool" },
        ],
      },
    ],
    outputs: [{ name: "orderId", type: "uint256" }],
  },
  { type: "function", name: "batchCheck", stateMutability: "nonpayable", inputs: [{ name: "orderIds", type: "uint256[]" }], outputs: [] },
  { type: "function", name: "checkAndExecute", stateMutability: "nonpayable", inputs: [{ name: "orderId", type: "uint256" }], outputs: [] },
  { type: "event", name: "OrderCreated", inputs: [{ name: "orderId", type: "uint256", indexed: false }, { name: "owner", type: "address", indexed: false }, { name: "cType", type: "uint8", indexed: false }, { name: "aType", type: "uint8", indexed: false }] },
  { type: "event", name: "OrderCancelled", inputs: [{ name: "orderId", type: "uint256", indexed: false }, { name: "owner", type: "address", indexed: false }] },
  { type: "event", name: "OrderTriggered", inputs: [{ name: "orderId", type: "uint256", indexed: false }, { name: "owner", type: "address", indexed: false }, { name: "timestamp", type: "uint256", indexed: false }] },
];


export const ORACLE_ABI = [
  { type: "function", name: "getPrice", stateMutability: "view", inputs: [{ name: "marketId", type: "bytes32" }], outputs: [{ type: "uint256" }] },
];


export const AI_GUARDRAILS_ABI = [
  { type: "function", name: "defaultThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "policyCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "claimCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalPremiums", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalPayouts", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

export const AGENTIC_DAO_ABI = [
  { type: "function", name: "proposalCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "latestMetrics", stateMutability: "view", inputs: [], outputs: [{ type: "tuple", components: [
    { name: "tvl", type: "uint256" },
    { name: "volume24h", type: "uint256" },
    { name: "activeUsers", type: "uint256" },
    { name: "feeBps", type: "uint256" },
    { name: "timestamp", type: "uint256" },
  ] }] },
];

export const KEEPER_SERVICE_ABI = [
  { type: "function", name: "clientCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalRevenue", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "monthlyRunRate", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "keeperRewardPool", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] },
];

export const ONCHAIN_ANALYTICS_ABI = [
  { type: "function", name: "getProtocolSummary", stateMutability: "view", inputs: [], outputs: [{ type: "tuple", components: [
    { name: "v24", type: "uint256" },
    { name: "f24", type: "uint256" },
    { name: "vAll", type: "uint256" },
    { name: "fAll", type: "uint256" },
    { name: "traders", type: "uint256" },
    { name: "liqAll", type: "uint256" },
    { name: "markets", type: "uint256" },
    { name: "ts", type: "uint256" },
  ] }] },
];

export const LAUNCHPAD_ABI = [
  { type: "function", name: "saleCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "protocolFees", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

export const LAUNCHPOOL_ABI = [
  { type: "function", name: "poolCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "protocolFees", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

export const LENDING_ABI = [
  { type: "function", name: "marketCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "protocolReserves", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

export const STAKING_ABI = [
  { type: "function", name: "totalLockedWIK", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalVeWIK", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "poolCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

export const PREDICTION_ABI = [
  { type: "function", name: "marketCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalVolume", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "protocolFees", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

export const VAULT_ABI = [
  { type: "function", name: "totalDeposits", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalMargin", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "protocolFees", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isSolvent", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
];

export const KEEPERS_ABI = [
  { type: "function", name: "keeperCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalPendingRewards", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isKeeper", stateMutability: "view", inputs: [{ name: "k", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "register", stateMutability: "nonpayable", inputs: [], outputs: [] },
];

export const CIRCUIT_BREAKER_ABI = [
  { type: "function", name: "isTripped", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "reset", stateMutability: "nonpayable", inputs: [], outputs: [] },
];

export const AUTOMATION_ABI = [
  { type: "function", name: "execute", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "executeDue", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "harvest", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "rebalance", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "process", stateMutability: "nonpayable", inputs: [], outputs: [] },
];

export const BOT_MANAGER_ABI = [
  { type: "function", name: "botCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "getBot",
    stateMutability: "view",
    inputs: [{ name: "botId", type: "uint256" }],
    outputs: [{
      type: "tuple",
      components: [
        { name: "owner", type: "address" },
        { name: "marketId", type: "bytes32" },
        { name: "isLong", type: "bool" },
        { name: "active", type: "bool" },
        { name: "maxNotional", type: "uint256" },
      ],
    }],
  },
  {
    type: "function",
    name: "registerBot",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "marketId", type: "bytes32" },
      { name: "isLong", type: "bool" },
      { name: "maxNotional", type: "uint256" },
    ],
    outputs: [{ name: "botId", type: "uint256" }],
  },
  { type: "function", name: "setBotActive", stateMutability: "nonpayable", inputs: [{ name: "botId", type: "uint256" }, { name: "active", type: "bool" }], outputs: [] },
];
