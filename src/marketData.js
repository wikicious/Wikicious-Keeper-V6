import { publicClient } from "./chain.js";
import { CONTRACTS, ORACLE_ABI, PERP_ABI } from "./contracts.js";
import { config } from "./config.js";
import { runtime, pushError } from "./state.js";

let cache = [];
let lastRefreshMs = 0;
const priceHistory = new Map();
const FALLBACK_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

async function fetchExternalPrices() {
  const out = { pyth: {}, chainlink: {} };
  const load = async (url, key) => {
    if (!url) return;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const json = await res.json();
      if (json && typeof json === "object") out[key] = json;
    } catch {}
  };
  await Promise.all([
    load(config.pythPriceUrl, "pyth"),
    load(config.chainlinkPriceUrl, "chainlink"),
  ]);
  return out;
}

function toNum(v, fallback = 0) {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function updatePriceHistory(symbol, price, atMs) {
  if (!symbol || !price || !Number.isFinite(price)) return [];
  const prev = priceHistory.get(symbol) || [];
  const next = [...prev, { ts: atMs, price }];
  const maxPoints = 120;
  if (next.length > maxPoints) next.splice(0, next.length - maxPoints);
  priceHistory.set(symbol, next);
  return next;
}

function buildPriceSignals(points, lastPrice) {
  if (!points?.length || !lastPrice) {
    return {
      lookbackPoints: 0,
      momentumBps: 0,
      volatilityBps: 0,
      breakoutUp: false,
      breakoutDown: false,
    };
  }

  const prices = points.map((p) => p.price).filter((x) => Number.isFinite(x) && x > 0);
  if (prices.length < 3) {
    return {
      lookbackPoints: prices.length,
      momentumBps: 0,
      volatilityBps: 0,
      breakoutUp: false,
      breakoutDown: false,
    };
  }

  const first = prices[0];
  const returns = [];
  for (let i = 1; i < prices.length; i += 1) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  const variance = returns.reduce((sum, r) => sum + r * r, 0) / Math.max(1, returns.length);
  const stdev = Math.sqrt(Math.max(0, variance));
  const recent = prices.slice(-20);
  const recentWithoutLast = recent.slice(0, -1);
  const priorHigh = recentWithoutLast.length ? Math.max(...recentWithoutLast) : recent[0];
  const priorLow = recentWithoutLast.length ? Math.min(...recentWithoutLast) : recent[0];

  return {
    lookbackPoints: prices.length,
    momentumBps: Math.round(((lastPrice - first) / first) * 10_000),
    volatilityBps: Math.round(stdev * 10_000),
    breakoutUp: recentWithoutLast.length > 0 && lastPrice > priorHigh,
    breakoutDown: recentWithoutLast.length > 0 && lastPrice < priorLow,
  };
}

async function fetchCexFallbackMarkets(now) {
  try {
    const query = encodeURIComponent(JSON.stringify(FALLBACK_SYMBOLS));
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${query}`);
    if (!res.ok) throw new Error(`ticker-http-${res.status}`);
    const json = await res.json();
    const rows = Array.isArray(json) ? json : [];
    const normalized = rows
      .map((r, i) => {
        const symbol = String(r?.symbol || "").toUpperCase();
        const priceNum = toNum(r?.price, 0);
        if (!symbol || priceNum <= 0) return null;
        const history = updatePriceHistory(symbol, priceNum, now);
        const signals = buildPriceSignals(history, priceNum);
        return {
          marketIndex: String(i),
          marketId: `cex:${symbol}`,
          symbol,
          active: true,
          price: priceNum,
          fees: { makerFeeBps: 10, takerFeeBps: 15, maintenanceMarginBps: 500 },
          funding: { fundingRate: 0, lastFundingTime: BigInt(Math.floor(now / 1000)) },
          openInterest: { long: 1_000_000n, short: 1_000_000n },
          signals,
          source: "binance-fallback",
          externalPrice: { pyth: null, chainlink: null },
        };
      })
      .filter(Boolean);
    return normalized;
  } catch {
    return FALLBACK_SYMBOLS.map((symbol, i) => {
      const priceNum = symbol.startsWith("BTC") ? 65000 : symbol.startsWith("ETH") ? 3200 : 140;
      const history = updatePriceHistory(symbol, priceNum, now);
      return {
        marketIndex: String(i),
        marketId: `synthetic:${symbol}`,
        symbol,
        active: true,
        price: priceNum,
        fees: { makerFeeBps: 10, takerFeeBps: 15, maintenanceMarginBps: 500 },
        funding: { fundingRate: 0, lastFundingTime: BigInt(Math.floor(now / 1000)) },
        openInterest: { long: 1_000_000n, short: 1_000_000n },
        signals: buildPriceSignals(history, priceNum),
        source: "synthetic-fallback",
        externalPrice: { pyth: null, chainlink: null },
      };
    });
  }
}

export function getMarketSnapshot() {
  return {
    updatedAt: runtime.marketData.updatedAt,
    count: cache.length,
    markets: cache,
  };
}

export async function refreshMarketSnapshot(force = false) {
  const now = Date.now();
  if (!force && now - lastRefreshMs < config.marketRefreshMs) return;

  try {
    const external = await fetchExternalPrices();
    const count = await publicClient.readContract({
      address: CONTRACTS.WikiPerp,
      abi: PERP_ABI,
      functionName: "marketCount",
    });

    const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
    const rows = ids.length > 0
      ? await Promise.all(
        ids.map(async (id) => {
          const m = await publicClient.readContract({
            address: CONTRACTS.WikiPerp,
            abi: PERP_ABI,
            functionName: "getMarket",
            args: [id],
          });

          let price = null;
          try {
            price = await publicClient.readContract({
              address: CONTRACTS.WikiOracle,
              abi: ORACLE_ABI,
              functionName: "getPrice",
              args: [m.marketId],
            });
          } catch {
            // Oracle may fail for paused/unknown market IDs.
          }

          const numericPrice = toNum(price, 0);
          const history = updatePriceHistory(m.symbol, numericPrice, now);
          const signals = buildPriceSignals(history, numericPrice);

          return {
            marketIndex: id.toString(),
            marketId: m.marketId,
            symbol: m.symbol,
            active: m.active,
            price,
            fees: {
              makerFeeBps: m.makerFeeBps,
              takerFeeBps: m.takerFeeBps,
              maintenanceMarginBps: m.maintenanceMarginBps,
            },
            funding: {
              fundingRate: m.fundingRate,
              lastFundingTime: m.lastFundingTime,
            },
            openInterest: {
              long: m.openInterestLong,
              short: m.openInterestShort,
            },
            signals,
            externalPrice: {
              pyth: external?.pyth?.[m.symbol] ?? null,
              chainlink: external?.chainlink?.[m.symbol] ?? null,
            },
          };
        }),
      )
      : await fetchCexFallbackMarkets(now);

    cache = rows;
    lastRefreshMs = now;
    runtime.marketData.updatedAt = new Date(now).toISOString();
    runtime.marketData.count = rows.length;
  } catch (error) {
    runtime.marketData.lastErrorAt = new Date().toISOString();
    pushError("markets.refresh", error);
  }
}
