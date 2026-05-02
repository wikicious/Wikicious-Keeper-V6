# Wikicious Keeper Bot + Backend API

Production-grade keeper for Wikicious DEX V6 on Arbitrum One.

## What runs 24/7

1. **Liquidator loop**: detects and liquidates unsafe perp positions.
2. **Funding loop**: settles funding for due active perp markets.
3. **Conditional order loop**: checks and executes trigger orders.
4. **Health/circuit checks**: pauses writes when circuit breaker is tripped.
5. **Backend API**: serves operational data for web/mobile clients.

## Quick start

```bash
cp .env.example .env
npm install
npm run start
```

Local API+keeper smoke test:

```bash
npm run test:e2e
```

Or with Docker:

```bash
docker compose up -d
curl http://localhost:8787/health
```

## Deploy on Oracle Cloud (Ubuntu VM)

Use these commands on a fresh Oracle Cloud Compute instance (Ubuntu 22.04/24.04):

```bash
# 1) Base packages + Docker
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl git ufw
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# 2) Clone project
git clone https://github.com/<your-org>/Wikicious-Keeper-V6.git
cd Wikicious-Keeper-V6

# 3) Configure env
cp .env.example .env
cat > .env <<'EOF'
PRIVATE_KEY=your_keeper_private_key
RPC_URL=https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY
API_PORT=8787
EOF
# Add any other optional env vars as needed

# 4) Start keeper + API
docker compose up -d --build

# 5) Verify
docker compose ps
curl http://127.0.0.1:8787/health
# Expect: STATUS includes "(healthy)" and health JSON includes `"ok":true`
```

Optional: run with PM2 (without Docker):

```bash
sudo apt update
sudo apt install -y nodejs npm
npm install
npm install -g pm2
pm2 start src/index.js --name wikicious-keeper
pm2 save
pm2 startup
```

## Environment

| Var | Required | Description |
|---|---|---|
| `PRIVATE_KEY` | yes | Keeper EOA private key. |
| `RPC_URL` | yes | Arbitrum RPC URL. |
| `RPC_WS_URL` | no | Optional websocket RPC URL. |
| `POLL_INTERVAL_MS` | no | Loop interval (default `4000`). |
| `DRY_RUN` | no | If `true`, no tx is broadcast. |
| `MARKETS_TO_WATCH` | no | CSV market indexes (empty = all). |
| `MAX_GAS_PRICE_GWEI` | no | Gas cap for tx broadcast. |
| `MARKET_REFRESH_MS` | no | Market cache refresh interval in milliseconds (default `5000`). |
| `DISCORD_WEBHOOK_URL` | no | Alert destination. |
| `API_ENABLED` | no | Set `false` to disable backend API. |
| `API_HOST` | no | API bind host (default `0.0.0.0`). |
| `API_PORT` | no | API bind port (default `8787`). |
| `API_KEY` | no | If set, protects private API routes (`/stats`, `/positions`, `/orders`, `/v1/*`). |
| `API_CORS_ORIGIN` | no | CORS allow-origin value (default `*`). |

## API endpoints

- `GET /health` and `GET /v1/health` → liveness and timestamps
- `GET /stats` and `GET /v1/stats` → keeper config/runtime stats + protocol snapshot
- `GET /positions` and `GET /v1/positions` → tracked open position IDs
- `GET /orders` and `GET /v1/orders` → tracked conditional order IDs
- `GET /markets` and `GET /v1/markets` → live market snapshot (price + fees + funding + OI)
- `GET /ai/strategy` and `GET /v1/ai/strategy` → rule-based AI trade ideas from market/funding/fee signals
- `GET /ai/contracts` and `GET /v1/ai/contracts` → live state from on-chain AI contracts (AIGuardrails, AgenticDAO, KeeperService, Analytics)
- `GET /business/overview` and `GET /v1/business/overview` → core business-flow contract KPIs (Launchpad, LaunchPool, Lending, Staking, Predictions, Vault)
- `POST /ai/strategy/compile` and `POST /v1/ai/strategy/compile` → compile user prompt + risk into strategy intent
- `POST /ai/bots` / `GET /ai/bots` / `POST /ai/bots/run` (and `/v1/*`) → create, list, and run AI bot paper plans

Authentication:
- if `API_KEY` is set, pass it with either:
  - `Authorization: Bearer <API_KEY>`
  - `x-api-key: <API_KEY>`

These endpoints are intentionally backend-friendly so your mobile app can consume them directly.

## File map

- `src/index.js` — orchestrator + main loop
- `src/liquidator.js` — open-position tracking + liquidations
- `src/funding.js` — funding settlement tick
- `src/orders.js` — conditional order bootstrap/watch/execute
- `src/backend.js` — HTTP API server
- `src/state.js` — shared runtime metrics/errors
- `src/contracts.js` — addresses + keeper ABIs

## Safety

- Every write uses simulation before broadcast.
- Global gas cap blocks expensive txs.
- Circuit breaker auto-halts write paths.
- Set `DRY_RUN=true` for shadow mode.
