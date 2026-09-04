'use strict';

const { randomUUID } = require('crypto');
const catalogService = require('./catalogService');
const discountService = require('./discountService');
const { requireShopperId } = require('./shopperContext');

// In-memory carts keyed by shopper id. Restarting the API clears them.
const carts = new Map();

function createEmptyCart(shopperId) {
  return {
    id: `cart-${shopperId}`,
    shopperId,
    items: [],
  };
}

function getCartState(shopperId) {
  const id = requireShopperId(shopperId);
  if (!carts.has(id)) {
    carts.set(id, createEmptyCart(id));
  }
  return carts.get(id);
}

function applyItemPricing(item) {
  const product = catalogService.getProductById(item.productId);
  const variant = product
    ? catalogService.resolveVariant(product, item.variantId)
    : null;

  if (variant) {
    item.unitPrice = variant.price;
  }

  const priced = discountService.evaluateLineItem({
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    productId: item.productId,
    originatingLiveSessionId: item.originatingLiveSessionId,
  });

  item.listPrice = priced.listPrice;
  item.unitPrice = priced.unitPrice;
  item.discountEligible = priced.discountEligible;
  item.discountPercent = priced.discountPercent;
  item.discountAmount = priced.discountAmount;
  item.effectiveUnitPrice = priced.effectiveUnitPrice;
  item.effectivePrice = priced.effectiveUnitPrice;
  item.lineTotal = priced.lineTotal;
  item.originatingLiveSessionId = priced.originatingLiveSessionId;

  return item;
}

function recalculate(cartState) {
  let subtotal = 0;
  let discountTotal = 0;
  let itemCount = 0;

  for (const item of cartState.items) {
    applyItemPricing(item);
    subtotal += item.lineTotal;
    discountTotal += item.discountAmount;
    itemCount += item.quantity;
  }

  cartState.subtotal = subtotal;
  cartState.discountTotal = discountTotal;
  cartState.itemCount = itemCount;
  cartState.currency = 'INR';
  return cartState;
}

function getCart(shopperId) {
  const cart = getCartState(shopperId);
  return recalculate({ ...cart, items: cart.items.map((i) => ({ ...i })) });
}

function addItem(
  shopperId,
  { productId, variantId, quantity = 1, originatingLiveSessionId = null },
) {
  const cart = getCartState(shopperId);
  const product = catalogService.getProductById(productId);
  if (!product) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }

  const variant =
    catalogService.resolveVariant(product, variantId) || catalogService.pickDefaultVariant(product);
  if (!variant) {
    const err = new Error('Variant not found');
    err.status = 404;
    throw err;
  }

  if (!variant.inStock) {
    const err = new Error('Selected variant is out of stock');
    err.status = 400;
    throw err;
  }

  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
    const err = new Error('Quantity must be an integer between 1 and 10');
    err.status = 400;
    throw err;
  }

  const sessionKey = originatingLiveSessionId || null;
  const existing = cart.items.find(
    (item) =>
      item.productId === productId &&
      item.variantId === variant.id &&
      (item.originatingLiveSessionId || null) === sessionKey,
  );

  if (existing) {
    existing.quantity += qty;
    existing.unitPrice = variant.price;
  } else {
    cart.items.push({
      id: randomUUID(),
      productId: product.id,
      variantId: variant.id,
      productName: product.name,
      variantName: variant.name,
      brand: product.brand,
      image: product.images[0],
      unitPrice: variant.price,
      quantity: qty,
      originatingLiveSessionId: sessionKey,
      lineTotal: variant.price * qty,
    });
  }

  return getCart(shopperId);
}

function updateItem(shopperId, itemId, { quantity }) {
  const cart = getCartState(shopperId);
  const item = cart.items.find((i) => i.id === itemId);
  if (!item) {
    const err = new Error('Cart item not found');
    err.status = 404;
    throw err;
  }

  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
    const err = new Error('Quantity must be an integer between 1 and 10');
    err.status = 400;
    throw err;
  }

  item.quantity = qty;
  return getCart(shopperId);
}

function removeItem(shopperId, itemId) {
  const cart = getCartState(shopperId);
  const index = cart.items.findIndex((i) => i.id === itemId);
  if (index === -1) {
    const err = new Error('Cart item not found');
    err.status = 404;
    throw err;
  }
  cart.items.splice(index, 1);
  return getCart(shopperId);
}

function clearCart(shopperId) {
  const cart = getCartState(shopperId);
  cart.items = [];
  return getCart(shopperId);
}

function resetAllCarts() {
  carts.clear();
}

module.exports = {
  getCart,
  addItem,
  updateItem,
  removeItem,
  clearCart,
  resetAllCarts,
};
