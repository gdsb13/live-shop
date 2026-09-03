'use strict';

const { RtcTokenBuilder, RtmTokenBuilder, RtcRole } = require('agora-token');
const liveSessionService = require('./liveSessionService');

const TOKEN_TTL_SECONDS = 3600;

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function sanitizeEnv(value, name) {
  const cleaned = String(value || '')
    .trim()
    .replace(/\r/g, '');
  if (!cleaned) {
    throw httpError(`${name} is not configured on the server`, 503);
  }
  return cleaned;
}

function requireConfig() {
  const appId = sanitizeEnv(process.env.AGORA_APP_ID, 'AGORA_APP_ID');
  const appCertificate = sanitizeEnv(process.env.AGORA_APP_CERTIFICATE, 'AGORA_APP_CERTIFICATE');

  if (!/^[0-9a-fA-F]{32}$/.test(appId)) {
    throw httpError(
      'AGORA_APP_ID must be the 32-character hexadecimal App ID from Agora Console (no spaces or quotes)',
      500,
    );
  }
  if (!/^[0-9a-fA-F]{32}$/.test(appCertificate)) {
    throw httpError(
      'AGORA_APP_CERTIFICATE must be the 32-character Primary Certificate from Agora Console',
      500,
    );
  }

  return { appId, appCertificate };
}

function getSignalingArea() {
  const raw = String(process.env.AGORA_SIGNALING_AREA || 'AUTO')
    .trim()
    .toUpperCase();
  if (!raw || raw === 'AUTO') return 'AUTO';
  return raw;
}

function getSignalingAreasToTry() {
  const primary = getSignalingArea();
  if (primary !== 'AUTO') {
    return [primary];
  }
  // Default to SDK auto-routing. Extra regions are only attempted after -10003.
  return ['AUTO'];
}

function getSignalingFallbackAreas() {
  return [];
}

function buildRtmLoginToken(appId, appCertificate, userId) {
  // Agora docs: message-channel login uses AccessToken2 ServiceRtm + PrivilegeLogin.
  // Do not use buildTokenWithPermissions (RTM2 resource tokens need Agora enablement).
  return RtmTokenBuilder.buildToken(appId, appCertificate, userId, TOKEN_TTL_SECONDS);
}

function getPublicConfig() {
  const { appId } = requireConfig();
  return {
    configured: true,
    appIdLength: appId.length,
    appIdPrefix: appId.slice(0, 4),
    appIdSuffix: appId.slice(-4),
    signalingArea: getSignalingArea(),
    signalingAreas: getSignalingAreasToTry(),
    signalingFallbackAreas: getSignalingFallbackAreas(),
    verifyAppIdHint:
      'In Agora Console open project live-shop-rtc → copy App ID and Primary Certificate into .env, then restart ./scripts/start.sh',
  };
}

function rtcChannelName(sessionId) {
  return `live-${sessionId}`;
}

function chatChannelName(sessionId) {
  return `live-chat-${sessionId}`;
}

function assertUserId(userId) {
  if (!userId || typeof userId !== 'string' || userId.length < 3 || userId.length > 64) {
    throw httpError('userId is required', 400);
  }
  return userId;
}

function assertLiveSession(sessionId) {
  if (!sessionId) throw httpError('liveSessionId is required', 400);
  const session = liveSessionService.getSessionById(sessionId);
  if (!session) throw httpError('Live session not found', 404);
  if (session.status !== 'LIVE') {
    throw httpError('Agora is only available while session is LIVE', 400);
  }
  return session;
}

function issueRtcToken({ liveSessionId, userId, role }) {
  const { appId, appCertificate } = requireConfig();
  assertUserId(userId);
  assertLiveSession(liveSessionId);

  if (role !== 'host' && role !== 'audience') {
    throw httpError('role must be host or audience', 400);
  }

  // Prototype host authorization: host tokens only for host-* user ids from /host.
  // Production requires authenticated seller identity.
  if (role === 'host' && !userId.startsWith('host-')) {
    throw httpError('Host role is not authorized for this user', 403);
  }
  if (role === 'host') {
    require('./hostClaimService').claimHost(liveSessionId, userId);
  }
  if (role === 'audience' && !userId.startsWith('viewer-')) {
    throw httpError('Audience role requires a viewer user id', 400);
  }

  const channelName = rtcChannelName(liveSessionId);
  // Publisher tokens are required for RTC data-stream chat. Viewers still only
  // subscribe to A/V tracks in the client; they do not publish media.
  const rtcRole = RtcRole.PUBLISHER;
  const token = RtcTokenBuilder.buildTokenWithUserAccount(
    appId,
    appCertificate,
    channelName,
    userId,
    rtcRole,
    TOKEN_TTL_SECONDS,
    TOKEN_TTL_SECONDS,
  );

  return {
    appId,
    token,
    channelName,
    userId,
    role,
    liveSessionId,
    expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString(),
  };
}

function issueRtmToken({ liveSessionId, userId }) {
  const { appId, appCertificate } = requireConfig();
  assertUserId(userId);
  assertLiveSession(liveSessionId);

  if (!userId.startsWith('viewer-') && !userId.startsWith('host-')) {
    throw httpError('Invalid chat user id', 400);
  }

  const channel = chatChannelName(liveSessionId);
  const token = buildRtmLoginToken(appId, appCertificate, userId);

  return {
    appId,
    token,
    userId,
    chatChannelName: channel,
    liveSessionId,
    signalingArea: getSignalingArea(),
    signalingAreas: getSignalingAreasToTry(),
    signalingFallbackAreas: getSignalingFallbackAreas(),
    appIdPrefix: appId.slice(0, 4),
    appIdSuffix: appId.slice(-4),
    expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString(),
  };
}

module.exports = {
  rtcChannelName,
  chatChannelName,
  issueRtcToken,
  issueRtmToken,
  getPublicConfig,
};
