'use strict';

const { randomUUID } = require('crypto');
const cartService = require('./cartService');
const paymentOptionsService = require('./paymentOptionsService');

function checkout({ paymentMethod, deliveryPin, shopperId }) {
  const cart = cartService.getCart(shopperId);

  if (!cart.items.length) {
    const err = new Error('Cart is empty');
    err.status = 400;
    throw err;
  }

  const validMethods = paymentOptionsService
    .listPaymentOptions()
    .options.map((o) => o.id);

  if (!paymentMethod || !validMethods.includes(paymentMethod)) {
    const err = new Error(`paymentMethod must be one of: ${validMethods.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const order = {
    orderId: `ORD-${randomUUID().slice(0, 8).toUpperCase()}`,
    status: 'confirmed',
    paymentMethod,
    deliveryPin: deliveryPin || null,
    currency: cart.currency,
    subtotal: cart.subtotal,
    discountTotal: cart.discountTotal || 0,
    items: cart.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      productName: item.productName,
      variantName: item.variantName,
      quantity: item.quantity,
      listPrice: item.listPrice ?? item.unitPrice,
      unitPrice: item.unitPrice,
      discountEligible: Boolean(item.discountEligible),
      discountPercent: item.discountPercent || 0,
      discountAmount: item.discountAmount || 0,
      effectiveUnitPrice: item.effectiveUnitPrice ?? item.unitPrice,
      lineTotal: item.lineTotal,
      originatingLiveSessionId: item.originatingLiveSessionId || null,
    })),
    message: 'Mock checkout successful. No payment was processed.',
    createdAt: new Date().toISOString(),
  };

  cartService.clearCart(shopperId);
  return order;
}

module.exports = {
  checkout,
};
