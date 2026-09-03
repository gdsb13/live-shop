'use strict';

const { randomUUID } = require('crypto');
const { RtcTokenBuilder, RtmTokenBuilder, RtcRole } = require('agora-token');
const aiSessionStore = require('./aiSessionStore');
const aiToolService = require('./aiToolService');
const { ASSISTANT_GREETING, buildSystemPrompt } = require('./aiAssistantConfig');

const TOKEN_TTL_SECONDS = 3600;

function httpError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

function requireAgoraConfig() {
  const appId = String(process.env.AGORA_APP_ID || '').trim();
  const appCertificate = String(process.env.AGORA_APP_CERTIFICATE || '').trim();
  if (!appId || !appCertificate) {
    throw httpError('Agora credentials are not configured on the server', 503);
  }
  return { appId, appCertificate };
}

function publicApiBase() {
  return String(process.env.AI_PUBLIC_BASE_URL || '').replace(/\/$/, '');
}

function customLlmUrlForChannel(channel) {
  const base = publicApiBase();
  if (!base) return null;
  // Full OpenAI-compatible URL Agora CustomLLM calls directly.
  return `${base}/api/ai/llm/${encodeURIComponent(channel)}/chat/completions`;
}

function buildRtcToken(appId, appCertificate, channelName, userId) {
  return RtcTokenBuilder.buildTokenWithUserAccount(
    appId,
    appCertificate,
    channelName,
    userId,
    RtcRole.PUBLISHER,
    TOKEN_TTL_SECONDS,
    TOKEN_TTL_SECONDS,
  );
}

function buildRtmToken(appId, appCertificate, userId) {
  return RtmTokenBuilder.buildToken(appId, appCertificate, userId, TOKEN_TTL_SECONDS);
}

async function loadAgentKit() {
  return import('agora-agents');
}

function buildSessionContext({ surface, shopperUserId, liveSessionId, productId }) {
  const liveContext = liveSessionId ? aiToolService.buildLiveContext(liveSessionId) : null;
  return {
    id: randomUUID(),
    surface: surface || 'storefront',
    shopperUserId,
    channel: `ai-${shopperUserId}`,
    liveSessionId: liveSessionId || null,
    productId: productId || null,
    liveContext,
    lastProductIds:
      liveContext && liveContext.featuredProductId ? [liveContext.featuredProductId] : [],
    cartUpdated: false,
    transcripts: [],
    awaitingSearchQuery: false,
    lastSearchQuery: null,
    state: 'starting',
    mode: publicApiBase() ? 'agora' : 'local',
  };
}

// Start the private Agora Conversational AI session for one shopper.
async function startAgoraVoiceSession(sessionContext) {
  const llmUrl = customLlmUrlForChannel(sessionContext.channel);
  if (!llmUrl) {
    throw httpError(
      'AI_PUBLIC_BASE_URL is not configured. Agora cloud must reach the commerce LLM endpoint over HTTPS (for example via ngrok).',
      503,
      'AI_PUBLIC_URL_REQUIRED',
    );
  }

  const { appId, appCertificate } = requireAgoraConfig();
  const {
    AgoraClient,
    Agent,
    Area,
    DeepgramSTT,
    CustomLLM,
    MiniMaxTTS,
    ExpiresIn,
  } = await loadAgentKit();

  const areaName = String(process.env.AGORA_AI_AREA || 'AP').toUpperCase();
  const area = Area[areaName] || Area.AP;
  const customLlmKey = process.env.AI_CUSTOM_LLM_API_KEY || 'live-shop-ai-key';

  const client = new AgoraClient({
    area,
    appId,
    appCertificate,
  });

  const agent = new Agent({ client })
    .withStt(
      new DeepgramSTT({
        model: 'nova-3',
        language: 'en-US',
      }),
    )
    .withLlm(
      new CustomLLM({
        apiKey: customLlmKey,
        url: llmUrl,
        model: 'live-shop-commerce',
        systemMessages: [{ role: 'system', content: buildSystemPrompt(sessionContext) }],
      }),
    )
    .withTts(
      new MiniMaxTTS({
        model: 'speech_2_6_turbo',
      }),
    )
    .withParameters({
      data_channel: 'rtm',
      enable_metrics: true,
    });

  const agentUid = `ai-agent-${randomUUID().slice(0, 8)}`;
  const agentSession = agent.createSession({
    name: `voice-ai-${sessionContext.id}`,
    channel: sessionContext.channel,
    agentUid,
    remoteUids: [sessionContext.shopperUserId],
    enableStringUid: true,
    idleTimeout: 120,
    expiresIn: ExpiresIn.hours(1),
  });

  const agentId = await agentSession.start();

  return {
    ...sessionContext,
    appId,
    agentId,
    agentUid,
    agentSession,
    client,
    state: 'running',
    mode: 'agora',
    createdAt: new Date().toISOString(),
  };
}

function startLocalVoiceSession(sessionContext) {
  return {
    ...sessionContext,
    state: 'running',
    mode: 'local',
    createdAt: new Date().toISOString(),
  };
}

async function startVoiceSession(body) {
  const surface = body.surface || 'storefront';
  const shopperUserId = body.shopperUserId;
  if (!shopperUserId || typeof shopperUserId !== 'string') {
    throw httpError('shopperUserId is required', 400);
  }

  let sessionContext = buildSessionContext({
    surface,
    shopperUserId,
    liveSessionId: body.liveSessionId,
    productId: body.productId,
  });

  if (sessionContext.mode === 'agora') {
    sessionContext = await startAgoraVoiceSession(sessionContext);
  } else {
    sessionContext = startLocalVoiceSession(sessionContext);
  }

  aiSessionStore.createSession(sessionContext);

  const response = {
    sessionId: sessionContext.id,
    mode: sessionContext.mode,
    channel: sessionContext.channel,
    shopperUserId: sessionContext.shopperUserId,
    surface: sessionContext.surface,
    greeting: ASSISTANT_GREETING,
    publicBaseConfigured: Boolean(publicApiBase()),
  };

  if (sessionContext.mode === 'agora') {
    response.appId = sessionContext.appId;
    response.agentUid = sessionContext.agentUid;
    response.rtcToken = buildRtcToken(
      sessionContext.appId,
      requireAgoraConfig().appCertificate,
      sessionContext.channel,
      sessionContext.shopperUserId,
    );
    response.rtmToken = buildRtmToken(
      sessionContext.appId,
      requireAgoraConfig().appCertificate,
      sessionContext.shopperUserId,
    );
  }

  return response;
}

async function stopVoiceSession(sessionId, shopperUserId) {
  const record = aiSessionStore.getSession(sessionId);
  if (!record) throw httpError('Voice AI session not found', 404);
  if (record.shopperUserId !== shopperUserId) {
    throw httpError('Not authorized for this voice session', 403);
  }

  if (record.mode === 'agora' && record.agentSession) {
    try {
      await record.agentSession.stop();
    } catch {
      // Agent may already have stopped after idle timeout.
    }
  }

  aiSessionStore.deleteSession(sessionId);
  return { stopped: true };
}

function getVoiceSession(sessionId) {
  const record = aiSessionStore.getSession(sessionId);
  if (!record) return null;
  const cartUpdated = Boolean(record.cartUpdated);
  if (cartUpdated) {
    record.cartUpdated = false;
    aiSessionStore.updateSession(sessionId, record);
  }
  return {
    sessionId: record.id,
    mode: record.mode,
    state: record.state,
    surface: record.surface,
    channel: record.channel,
    cartUpdated,
    transcripts: record.transcripts.slice(-20),
  };
}

function runLocalTurn(sessionId, text) {
  const record = aiSessionStore.getSession(sessionId);
  if (!record) throw httpError('Voice AI session not found', 404);

  const { runMockAgentTurn } = require('./aiLlmProxy');
  const messages = [{ role: 'user', content: text }];
  const turn = runMockAgentTurn(messages, record);

  record.transcripts.push({ role: 'user', text, ts: new Date().toISOString() });
  record.transcripts.push({ role: 'assistant', text: turn.reply, ts: new Date().toISOString() });
  record.lastProductIds = turn.lastProductIds;
  record.cartUpdated = Boolean(turn.cartUpdated);
  if (record.lastSearchQuery === undefined) {
    record.lastSearchQuery = null;
  }
  aiSessionStore.updateSession(sessionId, record);

  return {
    reply: turn.reply,
    cartUpdated: turn.cartUpdated,
    endSession: Boolean(turn.endSession),
    transcripts: record.transcripts.slice(-20),
  };
}

function attachSessionContextByChannel(channel) {
  const record = aiSessionStore.getSessionByChannel(channel);
  if (!record) return null;
  return record;
}

function updateSessionFromLlmTurn(channel, turnMeta) {
  const record = aiSessionStore.getSessionByChannel(channel);
  if (!record || !turnMeta) return;
  record.lastProductIds = turnMeta.lastProductIds || record.lastProductIds;
  record.cartUpdated = Boolean(turnMeta.cartUpdated);
  aiSessionStore.updateSession(record.id, record);
}

module.exports = {
  startVoiceSession,
  stopVoiceSession,
  getVoiceSession,
  runLocalTurn,
  attachSessionContextByChannel,
  updateSessionFromLlmTurn,
  publicApiBase,
};
