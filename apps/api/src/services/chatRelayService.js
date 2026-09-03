'use strict';

const liveSessionService = require('./liveSessionService');

const messagesBySession = new Map();

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function assertLiveSession(sessionId) {
  const session = liveSessionService.getSessionById(sessionId);
  if (!session) throw httpError('Live session not found', 404);
  if (session.status !== 'LIVE') {
    throw httpError('Chat is only available while session is LIVE', 400);
  }
  return session;
}

function listMessages(sessionId) {
  assertLiveSession(sessionId);
  return messagesBySession.get(sessionId) || [];
}

function postMessage(sessionId, { sender, text }) {
  assertLiveSession(sessionId);
  const trimmed = String(text || '').trim();
  const name = String(sender || '').trim();
  if (!trimmed) throw httpError('text is required', 400);
  if (!name) throw httpError('sender is required', 400);

  const message = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sender: name.slice(0, 64),
    text: trimmed.slice(0, 500),
    ts: new Date().toISOString(),
  };

  const existing = messagesBySession.get(sessionId) || [];
  const next = [...existing, message].slice(-100);
  messagesBySession.set(sessionId, next);
  return message;
}

module.exports = {
  listMessages,
  postMessage,
};
