export const runtime = {
  startedAt: new Date().toISOString(),
  lastTickAt: null,
  tickCount: 0,
  lastErrors: [],
  liquidations: { attempts: 0, sent: 0, lastTx: null, watchedPositions: 0 },
  funding: { attempts: 0, sent: 0, lastSettledMarket: null, lastTx: null },
  conditionalOrders: { attempts: 0, sent: 0, tracked: 0, lastExecutedOrderId: null, lastTx: null },
  marketData: { updatedAt: null, count: 0, lastErrorAt: null },
  keeper: { isKeeper: null, lastMaintenanceAt: null, registeredAt: null, lastClaimTx: null },
  automation: { lastRunAt: null, tasks: {}, history: [] },
};

export function pushError(scope, error) {
  runtime.lastErrors.unshift({
    scope,
    message: error?.shortMessage || error?.message || String(error),
    at: new Date().toISOString(),
  });
  runtime.lastErrors = runtime.lastErrors.slice(0, 20);
}
