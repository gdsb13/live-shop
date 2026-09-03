'use strict';

const fs = require('fs');
const path = require('path');
const catalogService = require('./catalogService');

const seedPath = path.join(__dirname, '../data/liveSessions.json');

// Mutable in-memory sessions. API restart resets to seed.
// Production would persist session lifecycle in customer infrastructure.
let sessions = JSON.parse(fs.readFileSync(seedPath, 'utf8')).map((session) => ({
  ...session,
}));

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function clone(session) {
  return { ...session };
}

function enrichSession(session) {
  const products = session.productIds
    .map((id) => catalogService.getProductById(id))
    .filter(Boolean)
    .map((product) => catalogService.summarizeProduct(product));

  const featuredProduct = session.featuredProductId
    ? products.find((p) => p.id === session.featuredProductId) || null
    : null;

  return {
    ...clone(session),
    products,
    featuredProduct,
  };
}

function listSessions() {
  return sessions.map(enrichSession);
}

function getSessionById(id) {
  const session = sessions.find((s) => s.id === id);
  if (!session) return null;
  return enrichSession(session);
}

function startSession(id) {
  const session = sessions.find((s) => s.id === id);
  if (!session) throw httpError('Live session not found', 404);
  if (session.status !== 'SCHEDULED') {
    throw httpError(`Cannot start session in status ${session.status}`, 400);
  }

  session.status = 'LIVE';
  session.startedAt = new Date().toISOString();
  session.endedAt = null;

  if (!session.featuredProductId && session.productIds.length > 0) {
    session.featuredProductId = session.productIds[0];
  }

  return enrichSession(session);
}

function endSession(id) {
  const session = sessions.find((s) => s.id === id);
  if (!session) throw httpError('Live session not found', 404);
  if (session.status !== 'LIVE') {
    throw httpError(`Cannot end session in status ${session.status}`, 400);
  }

  session.status = 'ENDED';
  session.endedAt = new Date().toISOString();

  require('./hostClaimService').clearSession(id);

  return enrichSession(session);
}

function setFeaturedProduct(id, productId) {
  const session = sessions.find((s) => s.id === id);
  if (!session) throw httpError('Live session not found', 404);
  if (session.status !== 'LIVE') {
    throw httpError('Featured product can only be changed while session is LIVE', 400);
  }
  if (!session.productIds.includes(productId)) {
    throw httpError('Product is not associated with this session', 400);
  }
  if (!catalogService.getProductById(productId)) {
    throw httpError('Product not found in catalogue', 404);
  }

  session.featuredProductId = productId;
  return enrichSession(session);
}

module.exports = {
  listSessions,
  getSessionById,
  startSession,
  endSession,
  setFeaturedProduct,
};
