'use strict';

const { randomUUID } = require('crypto');
const catalogService = require('./catalogService');

// In-memory demo cart. Restarting the API clears it.
// Production would use persistent customer/cart/order infrastructure.
let cart = {
  id: 'demo-cart',
  items: [],
};

function recalculate(cartState) {
  let subtotal = 0;
  let itemCount = 0;

  for (const item of cartState.items) {
    item.lineTotal = item.unitPrice * item.quantity;
    subtotal += item.lineTotal;
    itemCount += item.quantity;
  }

  cartState.subtotal = subtotal;
  cartState.itemCount = itemCount;
  cartState.currency = 'INR';
  return cartState;
}

function getCart() {
  return recalculate({ ...cart, items: cart.items.map((i) => ({ ...i })) });
}

function addItem({ productId, variantId, quantity = 1 }) {
  const product = catalogService.getProductById(productId);
  if (!product) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }

  const variant = catalogService.resolveVariant(product, variantId) || catalogService.pickDefaultVariant(product);
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

  const existing = cart.items.find(
    (item) => item.productId === productId && item.variantId === variantId,
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
      lineTotal: variant.price * qty,
    });
  }

  return getCart();
}

function updateItem(itemId, { quantity }) {
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
  return getCart();
}

function removeItem(itemId) {
  const index = cart.items.findIndex((i) => i.id === itemId);
  if (index === -1) {
    const err = new Error('Cart item not found');
    err.status = 404;
    throw err;
  }
  cart.items.splice(index, 1);
  return getCart();
}

function clearCart() {
  cart.items = [];
  return getCart();
}

module.exports = {
  getCart,
  addItem,
  updateItem,
  removeItem,
  clearCart,
};
