'use strict';

// DiscountPolicyService — single source of truth for LIVE session pricing.
// Eligibility requires ALL of:
//   1. originatingLiveSessionId on the cart add
//   2. LiveSession.status === 'LIVE' (set after successful host broadcast publish)
//      — never inferred from scheduledAt, startedAt, or current time
//   3. productId is in that session's productIds (any session product, not only featured)
// Reads application LiveSession state only; does not query Agora RTC/presence.
// Discount is re-evaluated on every cart/checkout read; ending the session removes it.

const LIVE_DISCOUNT_PERCENT = 20;

function getLiveSessionService() {
  return require('./liveSessionService');
}

function normalizeSessionId(originatingLiveSessionId) {
  if (!originatingLiveSessionId || typeof originatingLiveSessionId !== 'string') {
    return null;
  }
  const trimmed = originatingLiveSessionId.trim();
  return trimmed || null;
}

function isDiscountEligible({ productId, originatingLiveSessionId }) {
  const sessionId = normalizeSessionId(originatingLiveSessionId);
  if (!sessionId || !productId) {
    return false;
  }

  const session = getLiveSessionService().getRawSessionById(sessionId);
  if (!session || session.status !== 'LIVE') {
    return false;
  }

  return session.productIds.includes(productId);
}

function getDiscountPercent({ productId, originatingLiveSessionId }) {
  return isDiscountEligible({ productId, originatingLiveSessionId }) ? LIVE_DISCOUNT_PERCENT : 0;
}

function evaluateLineItem({ unitPrice, quantity = 1, productId, originatingLiveSessionId }) {
  const listPrice = Number(unitPrice);
  const qty = Number(quantity);
  const discountEligible = isDiscountEligible({ productId, originatingLiveSessionId });
  const discountPercent = discountEligible ? LIVE_DISCOUNT_PERCENT : 0;
  const unitDiscountAmount = discountEligible
    ? Math.round((listPrice * discountPercent) / 100)
    : 0;
  const effectiveUnitPrice = listPrice - unitDiscountAmount;
  const discountAmount = unitDiscountAmount * qty;
  const lineTotal = effectiveUnitPrice * qty;

  return {
    listPrice,
    unitPrice: listPrice,
    discountEligible,
    discountPercent,
    discountAmount,
    effectiveUnitPrice,
    effectivePrice: effectiveUnitPrice,
    lineTotal,
    originatingLiveSessionId: normalizeSessionId(originatingLiveSessionId),
  };
}

function trustedLiveSessionId(sessionContext) {
  // Only active LIVE Voice AI surface may attach originatingLiveSessionId for cart adds.
  // Recorded/replay uses surface 'recorded' — discount policy still requires session LIVE.
  if (!sessionContext || sessionContext.surface !== 'live') {
    return null;
  }
  return normalizeSessionId(sessionContext.liveSessionId);
}

module.exports = {
  LIVE_DISCOUNT_PERCENT,
  isDiscountEligible,
  getDiscountPercent,
  evaluateLineItem,
  trustedLiveSessionId,
};
