'use strict';

const catalogService = require('./catalogService');

function normalizePaymentMethod(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'upi' || raw.includes('upi') || raw.includes('gpay') || raw.includes('phonepe')) {
    return 'upi';
  }
  if (
    raw === 'card' ||
    raw.includes('credit') ||
    raw.includes('debit') ||
    raw.includes('visa') ||
    raw.includes('mastercard') ||
    raw.includes('rupay')
  ) {
    return 'card';
  }
  if (
    raw === 'cod' ||
    raw.includes('cash on delivery') ||
    raw.includes('cash-on-delivery') ||
    raw === 'cash'
  ) {
    return 'cod';
  }
  return raw;
}

function coercePaymentMethodValue(value) {
  if (value && typeof value === 'object') {
    return value.id || value.value || value.name || '';
  }
  return value;
}

function coerceProductIdValue(value) {
  if (value && typeof value === 'object') {
    return value.id || value.productId || value.value || value.name || '';
  }
  return value;
}

function normalizeProductId(value) {
  const raw = coerceProductIdValue(value);
  if (raw === undefined || raw === null || raw === '') return '';
  return catalogService.resolveProductId(String(raw));
}

// Normalize LLM-generated arguments. Recoverable validation is handled in tool functions.
function validateToolInput(toolName, args) {
  const input = args && typeof args === 'object' ? args : {};

  switch (toolName) {
    case 'getProduct':
    case 'getCurrentPrice':
    case 'addToCart':
    case 'removeFromCart':
      if (input.productId !== undefined && input.productId !== null && input.productId !== '') {
        input.productId = normalizeProductId(input.productId);
      }
      if (input.variantId !== undefined && input.variantId !== null && input.variantId !== '') {
        input.variantId = String(coerceProductIdValue(input.variantId));
      }
      break;
    case 'compareProducts':
      if (input.productIds !== undefined && !Array.isArray(input.productIds)) {
        input.productIds = input.productIds == null ? [] : [input.productIds];
      }
      if (Array.isArray(input.productIds)) {
        input.productIds = input.productIds
          .map((value) => normalizeProductId(value))
          .filter(Boolean);
      }
      break;
    case 'checkout': {
      if (input.deliveryPin !== undefined && input.deliveryPin !== null && input.deliveryPin !== '') {
        input.deliveryPin = String(input.deliveryPin);
      }
      input.paymentMethod = coercePaymentMethodValue(input.paymentMethod);
      if (input.paymentMethod !== undefined && input.paymentMethod !== null && input.paymentMethod !== '') {
        const paymentMethod = normalizePaymentMethod(input.paymentMethod);
        if (paymentMethod && ['upi', 'card', 'cod'].includes(paymentMethod)) {
          input.paymentMethod = paymentMethod;
        }
      }
      break;
    }
    default:
      break;
  }

  return input;
}

module.exports = {
  validateToolInput,
  normalizePaymentMethod,
  normalizeProductId,
};
