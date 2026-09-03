'use strict';

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Validate LLM-generated arguments before executing business logic.
function validateToolInput(toolName, args) {
  const input = args && typeof args === 'object' ? args : {};

  switch (toolName) {
    case 'searchProducts':
      if (!input.query && !input.category) {
        throw httpError('searchProducts requires query or category', 400);
      }
      break;
    case 'getProduct':
      if (!input.productId || typeof input.productId !== 'string') {
        throw httpError('getProduct requires productId', 400);
      }
      break;
    case 'compareProducts':
      if (!Array.isArray(input.productIds) || input.productIds.length < 2) {
        throw httpError('compareProducts requires at least two productIds', 400);
      }
      if (input.productIds.some((id) => typeof id !== 'string' || !id.trim())) {
        throw httpError('compareProducts productIds must be non-empty strings', 400);
      }
      break;
    case 'checkServiceability':
      if (!/^[1-9][0-9]{5}$/.test(String(input.pin || ''))) {
        throw httpError('checkServiceability requires a valid six-digit Indian PIN', 400);
      }
      break;
    case 'getPaymentOptions':
      break;
    case 'getCurrentPrice':
      if (!input.productId || !input.variantId) {
        throw httpError('getCurrentPrice requires productId and variantId', 400);
      }
      break;
    case 'addToCart':
      if (!input.productId || !input.variantId) {
        throw httpError('addToCart requires productId and variantId', 400);
      }
      if (input.quantity !== undefined) {
        const quantity = Number(input.quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
          throw httpError('addToCart quantity must be an integer between 1 and 10', 400);
        }
      }
      break;
    case 'removeFromCart':
      break;
    default:
      throw httpError(`Unknown tool "${toolName}"`, 400);
  }

  return input;
}

module.exports = {
  validateToolInput,
};
