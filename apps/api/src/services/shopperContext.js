'use strict';

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeShopperId(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 128) {
    return null;
  }
  return trimmed;
}

function requireShopperId(value, message = 'X-Shopper-Id header is required') {
  const id = normalizeShopperId(value);
  if (!id) {
    throw httpError(message, 400);
  }
  return id;
}

function fromRequest(req) {
  const header =
    (req.headers && (req.headers['x-shopper-id'] || req.headers['X-Shopper-Id'])) || '';
  return requireShopperId(header);
}

function fromSessionContext(sessionContext) {
  return requireShopperId(
    sessionContext && sessionContext.shopperUserId,
    'shopperUserId is required for cart operations',
  );
}

module.exports = {
  normalizeShopperId,
  requireShopperId,
  fromRequest,
  fromSessionContext,
};
