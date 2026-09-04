'use strict';

const liveSessionService = require('./liveSessionService');

const claims = new Map();

const TTL_MS = 45_000;

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function assertBroadcastableSession(sessionId) {
  const session = liveSessionService.getRawSessionById(sessionId);
  if (!session) throw httpError('Live session not found', 404);
  if (session.status === 'ENDED') {
    throw httpError('Host broadcast is not available for ended sessions', 400);
  }
  return session;
}

function assertLiveSession(sessionId) {
  const session = liveSessionService.getRawSessionById(sessionId);
  if (!session) throw httpError('Live session not found', 404);
  if (session.status !== 'LIVE') {
    throw httpError('Host broadcast heartbeat requires a LIVE session', 400);
  }
  return session;
}

function isStale(entry) {
  return Date.now() - entry.updatedAt > TTL_MS;
}

function pruneStale(sessionId) {
  const entry = claims.get(sessionId);
  if (entry && isStale(entry)) {
    claims.delete(sessionId);
    return null;
  }
  return entry;
}

function getStatus(sessionId) {
  const entry = pruneStale(sessionId);
  if (!entry) {
    return { broadcasting: false, hostUserId: null };
  }
  return { broadcasting: true, hostUserId: entry.hostUserId };
}

function claimHost(sessionId, userId) {
  assertBroadcastableSession(sessionId);
  if (!userId || typeof userId !== 'string' || !userId.startsWith('host-')) {
    throw httpError('Invalid host user id', 400);
  }

  const entry = pruneStale(sessionId);
  if (entry && entry.hostUserId !== userId) {
    throw httpError('Host already broadcasting on this session', 409);
  }

  claims.set(sessionId, { hostUserId: userId, updatedAt: Date.now() });
  return { sessionId, hostUserId: userId, broadcasting: true };
}

function heartbeat(sessionId, userId) {
  assertLiveSession(sessionId);
  const entry = pruneStale(sessionId);
  if (!entry || entry.hostUserId !== userId) {
    throw httpError('Not the active host for this session', 403);
  }
  entry.updatedAt = Date.now();
  return getStatus(sessionId);
}

function releaseHost(sessionId, userId) {
  const entry = claims.get(sessionId);
  if (entry && entry.hostUserId === userId) {
    claims.delete(sessionId);
  }
  return { released: true };
}

function assertHostClaim(sessionId, userId) {
  const entry = pruneStale(sessionId);
  if (!entry || entry.hostUserId !== userId) {
    throw httpError('Host broadcast claim required before publishing', 403);
  }
}

function clearSession(sessionId) {
  claims.delete(sessionId);
}

module.exports = {
  getStatus,
  claimHost,
  heartbeat,
  releaseHost,
  assertHostClaim,
  clearSession,
};
