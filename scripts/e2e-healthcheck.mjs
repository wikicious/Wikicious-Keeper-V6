import { spawn } from 'node:child_process';

const port = Number(process.env.TEST_API_PORT || 18787);
const env = {
  ...process.env,
  PRIVATE_KEY: process.env.PRIVATE_KEY || '1111111111111111111111111111111111111111111111111111111111111111',
  RPC_URL: process.env.RPC_URL || 'https://arb1.arbitrum.io/rpc',
  DRY_RUN: 'true',
  API_ENABLED: 'true',
  API_PORT: String(port),
  API_KEY: 'test-key',
  POLL_INTERVAL_MS: '1000',
  LIVE_EXECUTION_ENABLED: 'true',
};

const child = spawn('node', ['--enable-source-maps', 'src/index.js'], {
  cwd: new URL('..', import.meta.url),
  env,
  stdio: ['ignore', 'ignore', 'ignore'],
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(proc, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(), timeoutMs);
    proc.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

async function shutdown() {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await waitForExit(child, 2000);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await waitForExit(child, 2000);
  }
}

async function get(path, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  const text = await res.text();
  return { status: res.status, text };
}

async function post(path, body = {}, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function del(path, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'DELETE',
    headers,
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function patch(path, body = {}, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function main() {
  try {
    await sleep(2500);

    const health = await get('/health');
    if (health.status !== 200) throw new Error(`expected /health 200, got ${health.status}`);
    const metrics = await get('/metrics');
    if (metrics.status !== 200) throw new Error(`expected /metrics 200, got ${metrics.status}`);
    if (!metrics.text.includes('keeper_tick_count')) {
      throw new Error('expected /metrics payload to include keeper_tick_count');
    }

    const unauthorized = await get('/stats');
    if (unauthorized.status !== 401) throw new Error(`expected /stats 401, got ${unauthorized.status}`);

    const authorized = await get('/v1/stats', { 'x-api-key': 'test-key' });
    if (authorized.status !== 200) throw new Error(`expected /v1/stats 200, got ${authorized.status}`);
    const automation = await get('/v1/automation/status', { 'x-api-key': 'test-key' });
    if (automation.status !== 200) throw new Error(`expected /v1/automation/status 200, got ${automation.status}`);
    const automationParsed = JSON.parse(automation.text);
    if (!Object.prototype.hasOwnProperty.call(automationParsed, 'automation')) {
      throw new Error('expected automation status payload to include `automation` field');
    }
    const gapStatus = await get('/v1/automation/gap-status', { 'x-api-key': 'test-key' });
    if (gapStatus.status !== 200) throw new Error(`expected /v1/automation/gap-status 200, got ${gapStatus.status}`);
    const gapStatusParsed = JSON.parse(gapStatus.text);
    if (!Object.prototype.hasOwnProperty.call(gapStatusParsed, 'status')) {
      throw new Error('expected gap-status payload to include `status` field');
    }
    const runAutomation = await post('/v1/automation/run', {}, { 'x-api-key': 'test-key' });
    if (runAutomation.status !== 200) throw new Error(`expected /v1/automation/run 200, got ${runAutomation.status}`);
    const strictAutomation = await post('/v1/automation/run', { strict: true }, { 'x-api-key': 'test-key' });
    if (strictAutomation.status !== 409) throw new Error(`expected strict /v1/automation/run 409 in dry-run mode, got ${strictAutomation.status}`);
    const keeperMaintenance = await post('/v1/keeper/maintenance/run', {}, { 'x-api-key': 'test-key' });
    if (keeperMaintenance.status !== 200) throw new Error(`expected /v1/keeper/maintenance/run 200, got ${keeperMaintenance.status}`);
    const strictMaintenance = await post('/v1/keeper/maintenance/run', { strict: true }, { 'x-api-key': 'test-key' });
    if (strictMaintenance.status !== 409) throw new Error(`expected strict /v1/keeper/maintenance/run 409 in dry-run mode, got ${strictMaintenance.status}`);
    const automationHistory = await get('/v1/automation/history', { 'x-api-key': 'test-key' });
    if (automationHistory.status !== 200) throw new Error(`expected /v1/automation/history 200, got ${automationHistory.status}`);
    const automationHistoryParsed = JSON.parse(automationHistory.text);
    if (!Object.prototype.hasOwnProperty.call(automationHistoryParsed, 'history')) {
      throw new Error('expected automation history payload to include `history` field');
    }

    const markets = await get('/v1/markets', { 'x-api-key': 'test-key' });
    if (markets.status !== 200) throw new Error(`expected /v1/markets 200, got ${markets.status}`);
    const parsed = JSON.parse(markets.text);
    if (!Object.prototype.hasOwnProperty.call(parsed, 'markets')) {
      throw new Error('expected markets payload to include `markets` field');
    }

    const ai = await get('/v1/ai/strategy', { 'x-api-key': 'test-key' });
    if (ai.status !== 200) throw new Error(`expected /v1/ai/strategy 200, got ${ai.status}`);
    const aiParsed = JSON.parse(ai.text);
    if (!Object.prototype.hasOwnProperty.call(aiParsed, 'topIdeas')) {
      throw new Error('expected ai strategy payload to include `topIdeas` field');
    }

    const aiContracts = await get('/v1/ai/contracts', { 'x-api-key': 'test-key' });
    if (aiContracts.status !== 200) throw new Error(`expected /v1/ai/contracts 200, got ${aiContracts.status}`);
    const aiContractsParsed = JSON.parse(aiContracts.text);
    if (!Object.prototype.hasOwnProperty.call(aiContractsParsed, 'agenticDao')) {
      throw new Error('expected ai contracts payload to include `agenticDao` field');
    }
    const chatSession = await post('/v1/ai/chat/sessions', { title: 'E2E Session' }, { 'x-api-key': 'test-key' });
    if (chatSession.status !== 200) throw new Error(`expected /v1/ai/chat/sessions POST 200, got ${chatSession.status}`);
    const chatSessionParsed = JSON.parse(chatSession.text);
    if (!chatSessionParsed?.session?.id) throw new Error('expected chat session payload to include session.id');
    const chatMessage = await post('/v1/ai/chat/message', { sessionId: chatSessionParsed.session.id, message: 'Find conservative BTC setup', maxVolatilityBps: 380 }, { 'x-api-key': 'test-key' });
    if (chatMessage.status !== 200) throw new Error(`expected /v1/ai/chat/message 200, got ${chatMessage.status}`);
    const chatMessageParsed = JSON.parse(chatMessage.text);
    if (!chatMessageParsed?.assistant) throw new Error('expected chat message payload to include assistant');
    if (!Object.prototype.hasOwnProperty.call(chatMessageParsed, 'decision')) {
      throw new Error('expected chat message payload to include decision field');
    }
    if (!Object.prototype.hasOwnProperty.call(chatMessageParsed?.decision || {}, 'portfolioContext')) {
      throw new Error('expected chat decision payload to include portfolioContext field');
    }
    if (!Array.isArray(chatMessageParsed?.decision?.riskFlags)) {
      throw new Error('expected chat decision payload to include riskFlags array');
    }
    if (!chatMessageParsed?.decision?.gates?.maxVolatilityBps) {
      throw new Error('expected chat decision payload to include gates.maxVolatilityBps');
    }
    if (!chatMessageParsed?.decision?.generatedAt) {
      throw new Error('expected chat decision payload to include generatedAt');
    }
    if (!chatMessageParsed?.decision?.verdictLevel) {
      throw new Error('expected chat decision payload to include verdictLevel');
    }
    const chatRegenerate = await post('/v1/ai/chat/message', { sessionId: chatSessionParsed.session.id, regenerate: true, maxVolatilityBps: 380 }, { 'x-api-key': 'test-key' });
    if (chatRegenerate.status !== 200) throw new Error(`expected /v1/ai/chat/message regenerate 200, got ${chatRegenerate.status}`);
    const chatRegenerateParsed = JSON.parse(chatRegenerate.text);
    if (!chatRegenerateParsed?.regenerated) throw new Error('expected regenerate payload to include regenerated=true');
    const chatHistory = await get(`/v1/ai/chat/history?sessionId=${encodeURIComponent(chatSessionParsed.session.id)}`, { 'x-api-key': 'test-key' });
    if (chatHistory.status !== 200) throw new Error(`expected /v1/ai/chat/history 200, got ${chatHistory.status}`);
    const chatHistoryParsed = JSON.parse(chatHistory.text);
    const historyMessages = chatHistoryParsed?.session?.messages || [];
    const historyAssistantWithDecision = [...historyMessages].reverse().find((m) => m?.role === 'assistant' && m?.meta?.decision);
    if (!historyAssistantWithDecision) {
      throw new Error('expected chat history to persist assistant meta.decision');
    }
    const chatSessionsList = await get('/v1/ai/chat/sessions', { 'x-api-key': 'test-key' });
    if (chatSessionsList.status !== 200) throw new Error(`expected /v1/ai/chat/sessions GET 200, got ${chatSessionsList.status}`);
    const chatSessionsListParsed = JSON.parse(chatSessionsList.text);
    if (!Array.isArray(chatSessionsListParsed?.sessions) || chatSessionsListParsed.sessions.length === 0) {
      throw new Error('expected chat sessions payload to include non-empty sessions array');
    }
    const renameChatSession = await patch('/v1/ai/chat/sessions', { sessionId: chatSessionParsed.session.id, title: 'Renamed E2E Session' }, { 'x-api-key': 'test-key' });
    if (renameChatSession.status !== 200) throw new Error(`expected /v1/ai/chat/sessions PATCH 200, got ${renameChatSession.status}`);
    const renameChatSessionParsed = JSON.parse(renameChatSession.text);
    if (renameChatSessionParsed?.session?.title !== 'Renamed E2E Session') {
      throw new Error('expected renamed session payload to include updated title');
    }
    const deleteChatSession = await del(`/v1/ai/chat/sessions?sessionId=${encodeURIComponent(chatSessionParsed.session.id)}`, { 'x-api-key': 'test-key' });
    if (deleteChatSession.status !== 200) throw new Error(`expected /v1/ai/chat/sessions DELETE 200, got ${deleteChatSession.status}`);

    const biz = await get('/v1/business/overview', { 'x-api-key': 'test-key' });
    if (biz.status !== 200) throw new Error(`expected /v1/business/overview 200, got ${biz.status}`);
    const bizParsed = JSON.parse(biz.text);
    if (!Object.prototype.hasOwnProperty.call(bizParsed, 'launchpad')) {
      throw new Error('expected business overview payload to include `launchpad` field');
    }
    const businessFlows = await get('/v1/business/flows', { 'x-api-key': 'test-key' });
    if (businessFlows.status !== 200) throw new Error(`expected /v1/business/flows 200, got ${businessFlows.status}`);
    const businessFlowsParsed = JSON.parse(businessFlows.text);
    if (!Array.isArray(businessFlowsParsed?.flows)) {
      throw new Error('expected business flows payload to include `flows` array');
    }
    const strictBusinessExecute = await post('/v1/business/execute', { flow: 'adl', strict: true }, { 'x-api-key': 'test-key' });
    if (strictBusinessExecute.status !== 409) throw new Error(`expected strict /v1/business/execute 409 in dry-run mode, got ${strictBusinessExecute.status}`);
    const strictBusinessExecuteAll = await post('/v1/business/execute-all', { strict: true }, { 'x-api-key': 'test-key' });
    if (strictBusinessExecuteAll.status !== 409) throw new Error(`expected strict /v1/business/execute-all 409 in dry-run mode, got ${strictBusinessExecuteAll.status}`);

    const compiled = await post('/v1/ai/strategy/compile', { prompt: 'Build BTC strategy', risk: { maxDrawdownBps: 900 } }, { 'x-api-key': 'test-key' });
    if (compiled.status !== 200) throw new Error(`expected /v1/ai/strategy/compile 200, got ${compiled.status}`);
    const compiledParsed = JSON.parse(compiled.text);
    if (!Object.prototype.hasOwnProperty.call(compiledParsed, 'constraints')) {
      throw new Error('expected compiled strategy payload to include `constraints` field');
    }

    const bot = await post('/v1/ai/bots', { prompt: 'Create bot', risk: { maxNotionalUsd: 2500 } }, { 'x-api-key': 'test-key' });
    if (bot.status !== 200) throw new Error(`expected /v1/ai/bots 200, got ${bot.status}`);
    const botParsed = JSON.parse(bot.text);
    if (!botParsed?.id) throw new Error('expected ai bot payload to include `id`');

    const wiring = await get('/v1/ai/wiring/status', { 'x-api-key': 'test-key' });
    if (wiring.status !== 200) throw new Error(`expected /v1/ai/wiring/status 200, got ${wiring.status}`);
    const wiringParsed = JSON.parse(wiring.text);
    if (!Object.prototype.hasOwnProperty.call(wiringParsed, 'checks')) {
      throw new Error('expected wiring status payload to include `checks` field');
    }

    const onchainBots = await get('/v1/ai/onchain-bots', { 'x-api-key': 'test-key' });
    if (onchainBots.status !== 200) throw new Error(`expected /v1/ai/onchain-bots 200, got ${onchainBots.status}`);
    const onchainBotsParsed = JSON.parse(onchainBots.text);
    if (!Object.prototype.hasOwnProperty.call(onchainBotsParsed, 'enabled')) {
      throw new Error('expected onchain bots payload to include `enabled` field');
    }

    const txStatus = await post('/v1/ai/tx/status', { txHash: `0x${'0'.repeat(64)}` }, { 'x-api-key': 'test-key' });
    if (txStatus.status !== 200) throw new Error(`expected /v1/ai/tx/status 200, got ${txStatus.status}`);
    const txStatusParsed = JSON.parse(txStatus.text);
    if (!Object.prototype.hasOwnProperty.call(txStatusParsed, 'status')) {
      throw new Error('expected tx status payload to include `status` field');
    }

    const preflight = await post('/v1/ai/bots/preflight', { id: botParsed.id }, { 'x-api-key': 'test-key' });
    if (preflight.status !== 200) throw new Error(`expected /v1/ai/bots/preflight 200, got ${preflight.status}`);
    const preflightParsed = JSON.parse(preflight.text);
    if (!Object.prototype.hasOwnProperty.call(preflightParsed, 'readiness')) {
      throw new Error('expected preflight payload to include `readiness` field');
    }
    if (!preflightParsed?.ticket?.id && preflightParsed?.preflight?.ok) {
      throw new Error('expected preflight ticket when preflight passes');
    }

    const run = await post('/v1/ai/bots/run', { id: botParsed.id }, { 'x-api-key': 'test-key' });
    if (run.status !== 400) throw new Error(`expected /v1/ai/bots/run 400 without runMode=live, got ${run.status}`);

    const autorun = await post('/v1/ai/bots/autorun', { id: botParsed.id, enabled: true, mode: 'live', intervalSec: 15 }, { 'x-api-key': 'test-key' });
    if (autorun.status !== 200) throw new Error(`expected /v1/ai/bots/autorun 200, got ${autorun.status}`);

    const recommendation = await get(`/v1/ai/bots/recommendation?id=${encodeURIComponent(botParsed.id)}`, { 'x-api-key': 'test-key' });
    if (recommendation.status !== 200) throw new Error(`expected /v1/ai/bots/recommendation 200, got ${recommendation.status}`);
    const recommendationParsed = JSON.parse(recommendation.text);
    if (!Object.prototype.hasOwnProperty.call(recommendationParsed, 'executionReadinessScore')) {
      throw new Error('expected recommendation payload to include `executionReadinessScore` field');
    }

    if (preflightParsed?.ticket?.id) {
      const liveRun = await post('/v1/ai/bots/run', { id: botParsed.id, runMode: 'live', preflightId: preflightParsed.ticket.id }, { 'x-api-key': 'test-key' });
      if (![200, 409].includes(liveRun.status)) throw new Error(`expected live /v1/ai/bots/run 200|409, got ${liveRun.status}`);
      const liveRunParsed = JSON.parse(liveRun.text);
      if (liveRun.status === 200 && !Object.prototype.hasOwnProperty.call(liveRunParsed, 'liveExecutionEnabled')) {
        throw new Error('expected live run payload to include `liveExecutionEnabled` field');
      }
    }

    console.log('e2e-healthcheck: ok');
  } finally {
    await shutdown();
  }
}

main().catch(async (err) => {
  console.error(err.message || err);
  await shutdown();
  process.exit(1);
});
