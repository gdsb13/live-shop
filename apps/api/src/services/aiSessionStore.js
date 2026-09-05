'use strict';

const sessions = new Map();

function createSession(record) {
  sessions.set(record.id, record);
  return record;
}

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

function getSessionByChannel(channel) {
  for (const session of sessions.values()) {
    if (session.channel === channel) return session;
  }
  return null;
}

function updateSession(sessionId, patch) {
  const existing = sessions.get(sessionId);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  sessions.set(sessionId, next);
  return next;
}

function deleteSession(sessionId) {
  sessions.delete(sessionId);
}

function listRunningSessions() {
  const running = [];
  for (const session of sessions.values()) {
    if (session.state === 'running') {
      running.push(session);
    }
  }
  return running;
}

module.exports = {
  createSession,
  getSession,
  getSessionByChannel,
  updateSession,
  deleteSession,
  listRunningSessions,
};
