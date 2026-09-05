'use strict';

const { randomUUID } = require('crypto');
const { RtcTokenBuilder, RtmTokenBuilder, RtcRole } = require('agora-token');
const aiSessionStore = require('./aiSessionStore');
const aiToolService = require('./aiToolService');
const cartService = require('./cartService');
const { ASSISTANT_GREETING, buildSystemPrompt } = require('./aiAssistantConfig');
const { requireMcpEndpoint, buildMcpServers } = require('../mcp/mcpConfig');

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

function parseRtcUid(value, fieldName) {
  const uid = Number(value);
  if (!Number.isInteger(uid) || uid <= 0 || uid > 4294967295) {
    throw httpError(`${fieldName} must be a positive integer RTC UID`, 400);
  }
  return uid;
}

function generateAgentRtcUid() {
  // Distinct numeric UID for the ConvoAI agent (not string account names).
  return Math.floor(900000001 + Math.random() * 99999998);
}

function buildRtcToken(appId, appCertificate, channelName, uid) {
  return RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    uid,
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

function buildSessionContext({ surface, shopperUserId, shopperRtcUid, liveSessionId, productId }) {
  const liveContext = liveSessionId ? aiToolService.buildLiveContext(liveSessionId) : null;
  // Private Voice AI channel — separate from public live broadcast channel live-{sessionId}.
  return {
    id: randomUUID(),
    surface: surface || 'storefront',
    shopperUserId,
    shopperRtcUid,
    channel: `ai-${shopperUserId}`,
    liveSessionId: liveSessionId || null,
    productId: productId || null,
    liveContext,
    lastProductIds:
      liveContext && liveContext.featuredProductId ? [liveContext.featuredProductId] : [],
    lastProductId: productId || (liveContext && liveContext.featuredProductId) || null,
    cartUpdated: false,
    transcripts: [],
    state: 'starting',
    lastActivityAt: new Date().toISOString(),
  };
}

function watchAgentSession(sessionId, agentSession) {
  if (!agentSession) return;

  const markEnded = (reason) => {
    const record = aiSessionStore.getSession(sessionId);
    if (!record || record.state === 'ended') return;
    console.log(`[VoiceAI] Agent ended session=${sessionId} reason=${reason}`);
    aiSessionStore.updateSession(sessionId, {
      ...record,
      state: 'ended',
      endReason: reason,
      agentSession: null,
    });
  };

  const events = ['stopped', 'error'];
  for (const eventName of events) {
    if (typeof agentSession.on === 'function') {
      try {
        agentSession.on(eventName, () => markEnded(eventName));
      } catch {
        // Event may not exist on this SDK version.
      }
    }
    if (typeof agentSession.addListener === 'function') {
      try {
        agentSession.addListener(eventName, () => markEnded(eventName));
      } catch {
        // Event may not exist on this SDK version.
      }
    }
  }
}

// Start a private Agora managed Voice AI session for this shopper.
async function startAgoraVoiceSession(sessionContext) {
  const mcpEndpoint = requireMcpEndpoint();
  const { appId, appCertificate } = requireAgoraConfig();
  const {
    AgoraClient,
    Agent,
    Area,
    DeepgramSTT,
    OpenAI,
    MiniMaxTTS,
    ExpiresIn,
  } = await loadAgentKit();

  const areaName = String(process.env.AGORA_AI_AREA || 'AP').toUpperCase();
  const area = Area[areaName] || Area.AP;
  const openAiModel = String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();

  console.log(
    `[VoiceAI] Starting managed agent channel=${sessionContext.channel} mcp=${mcpEndpoint}`,
  );

  const client = new AgoraClient({
    area,
    appId,
    appCertificate,
  });

  const agent = new Agent({
    client,
    advancedFeatures: {
      enable_rtm: true,
      enable_tools: true,
    },
    turnDetection: {
      config: {
        speech_threshold: 0.4,
        start_of_speech: {
          mode: 'vad',
          vad_config: {
            interrupt_duration_ms: 400,
            prefix_padding_ms: 200,
          },
        },
        end_of_speech: {
          mode: 'vad',
          vad_config: {
            silence_duration_ms: 720,
          },
        },
      },
    },
  })
    .withStt(
      new DeepgramSTT({
        model: 'nova-3',
        language: 'en-US',
      }),
    )
    .withLlm(
      new OpenAI({
        model: openAiModel,
        systemMessages: [{ role: 'system', content: buildSystemPrompt(sessionContext) }],
        greetingMessage: ASSISTANT_GREETING,
        maxHistory: 20,
        params: {
          parallel_tool_calls: false,
        },
        mcpServers: buildMcpServers(mcpEndpoint, sessionContext.channel),
      }),
    )
    .withTts(
      new MiniMaxTTS({
        model: 'speech_2_6_turbo',
        voiceId: 'English_captivating_female1',
      }),
    )
    .withParameters({
      audio_scenario: 'default',
      data_channel: 'rtm',
      enable_metrics: true,
      enable_error_message: true,
    });

  const agentUid = generateAgentRtcUid();
  const agentSession = agent.createSession({
    name: `voice-ai-${sessionContext.id}`,
    channel: sessionContext.channel,
    agentUid: String(agentUid),
    remoteUids: [String(sessionContext.shopperRtcUid)],
    enableStringUid: false,
    idleTimeout: 300,
    expiresIn: ExpiresIn.hours(1),
  });

  const agentId = await agentSession.start();
  console.log(`[VoiceAI] Managed agent started channel=${sessionContext.channel} agentId=${agentId}`);

  watchAgentSession(sessionContext.id, agentSession);

  return {
    ...sessionContext,
    appId,
    agentId,
    agentUid,
    agentSession,
    client,
    state: 'running',
    createdAt: new Date().toISOString(),
  };
}

async function startVoiceSession(body) {
  const surface = body.surface || 'storefront';
  const shopperUserId = body.shopperUserId;
  if (!shopperUserId || typeof shopperUserId !== 'string') {
    throw httpError('shopperUserId is required', 400);
  }
  const shopperRtcUid = parseRtcUid(body.shopperRtcUid, 'shopperRtcUid');

  requireMcpEndpoint();

  const sessionContext = buildSessionContext({
    surface,
    shopperUserId,
    shopperRtcUid,
    liveSessionId: body.liveSessionId,
    productId: body.productId,
  });
  sessionContext.state = 'pending';
  sessionContext.transcripts = [
    {
      role: 'assistant',
      text: ASSISTANT_GREETING,
      ts: new Date().toISOString(),
    },
  ];
  aiSessionStore.createSession(sessionContext);

  const { appId, appCertificate } = requireAgoraConfig();

  return {
    sessionId: sessionContext.id,
    channel: sessionContext.channel,
    shopperUserId: sessionContext.shopperUserId,
    surface: sessionContext.surface,
    greeting: ASSISTANT_GREETING,
    appId,
    shopperRtcUid: sessionContext.shopperRtcUid,
    rtcToken: buildRtcToken(
      appId,
      appCertificate,
      sessionContext.channel,
      sessionContext.shopperRtcUid,
    ),
    rtmToken: buildRtmToken(
      appId,
      appCertificate,
      String(sessionContext.shopperRtcUid),
    ),
  };
}

// Start the managed agent after the shopper has joined the private RTC channel.
async function activateVoiceSession(sessionId, shopperUserId) {
  const record = aiSessionStore.getSession(sessionId);
  if (!record) throw httpError('Voice AI session not found', 404);
  if (record.shopperUserId !== shopperUserId) {
    throw httpError('Not authorized for this voice session', 403);
  }
  if (record.state === 'running') {
    return { activated: true, agentId: record.agentId };
  }
  if (record.state !== 'pending') {
    throw httpError('Voice AI session cannot be activated', 400);
  }

  const sessionContext = await startAgoraVoiceSession({ ...record });
  aiSessionStore.updateSession(sessionId, sessionContext);

  return {
    activated: true,
    agentId: sessionContext.agentId,
    agentUid: sessionContext.agentUid,
  };
}

async function stopVoiceSession(sessionId, shopperUserId) {
  const record = aiSessionStore.getSession(sessionId);
  if (!record) throw httpError('Voice AI session not found', 404);
  if (record.shopperUserId !== shopperUserId) {
    throw httpError('Not authorized for this voice session', 403);
  }

  if (record.agentSession) {
    try {
      await record.agentSession.stop();
      console.log(`[VoiceAI] Managed agent stopped session=${sessionId}`);
    } catch {
      // Agent may already have stopped after idle timeout.
    }
  }

  aiSessionStore.updateSession(sessionId, { ...record, state: 'ended', agentSession: null });
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
    state: record.state,
    surface: record.surface,
    channel: record.channel,
    cartUpdated,
    orderCompleted: Boolean(record.orderCompleted),
    lastOrderId: record.lastOrderId || null,
    cart: cartService.getCart(record.shopperUserId),
    transcripts: Array.isArray(record.transcripts) ? record.transcripts.slice(-20) : [],
  };
}

module.exports = {
  startVoiceSession,
  activateVoiceSession,
  stopVoiceSession,
  getVoiceSession,
  publicApiBase,
};
