'use strict';

const catalogService = require('./catalogService');
const cartService = require('./cartService');
const serviceabilityService = require('./serviceabilityService');
const paymentOptionsService = require('./paymentOptionsService');
const liveSessionService = require('./liveSessionService');
const discountService = require('./discountService');
const checkoutService = require('./checkoutService');
const shopperContext = require('./shopperContext');
const { ALLOWED_TOOL_NAMES } = require('./aiToolDefinitions');
const { validateToolInput } = require('./aiToolValidation');

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function pickDefaultVariant(product) {
  if (!product) return null;
  return product.variants.find((variant) => variant.inStock) || product.variants[0] || null;
}

function resolveProductVariant(product, variantHint) {
  if (!product) return null;
  const resolved = catalogService.resolveVariant(product, variantHint);
  if (resolved) return resolved;
  return pickDefaultVariant(product);
}

function searchProducts({ query, category }) {
  const products = catalogService.listProducts({
    search: query || undefined,
    category: category || undefined,
  });
  return {
    count: products.length,
    products: products.slice(0, 5),
  };
}

function getProduct({ productId }) {
  const product = catalogService.getProductById(productId);
  if (!product) throw httpError('Product not found', 404);
  return {
    id: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    description: product.description,
    rating: product.rating,
    variantCount: product.variants.length,
    specifications: product.specifications,
    features: product.features,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      price: variant.price,
      inStock: variant.inStock,
      attributes: variant.attributes,
    })),
    defaultVariantId: (pickDefaultVariant(product) && pickDefaultVariant(product).id) || null,
  };
}

function compareProducts({ productIds }) {
  const products = catalogService.getProductsForComparison(productIds);
  if (products.length < 2) {
    throw httpError('At least two valid product ids are required for comparison', 400);
  }
  return { products };
}

function checkServiceability({ pin }) {
  return serviceabilityService.checkServiceability(pin);
}

function getPaymentOptions() {
  return paymentOptionsService.listPaymentOptions();
}

function mapCartItem(item) {
  return {
    id: item.id,
    productId: item.productId,
    productName: item.productName,
    variantId: item.variantId,
    variantName: item.variantName,
    quantity: item.quantity,
    listPrice: item.listPrice ?? item.unitPrice,
    unitPrice: item.unitPrice,
    discountEligible: Boolean(item.discountEligible),
    discountPercent: item.discountPercent || 0,
    discountAmount: item.discountAmount || 0,
    effectiveUnitPrice: item.effectiveUnitPrice ?? item.unitPrice,
    effectivePrice: item.effectiveUnitPrice ?? item.unitPrice,
    lineTotal: item.lineTotal,
    originatingLiveSessionId: item.originatingLiveSessionId || null,
  };
}

function mapCartSummary(cart) {
  return {
    itemCount: cart.itemCount,
    subtotal: cart.subtotal,
    discountTotal: cart.discountTotal || 0,
    currency: cart.currency,
    items: cart.items.map(mapCartItem),
  };
}

function cartShopperId(sessionContext = {}) {
  return shopperContext.fromSessionContext(sessionContext);
}

function getCart(sessionContext = {}) {
  const shopperId = cartShopperId(sessionContext);
  const cart = cartService.getCart(shopperId);
  return mapCartSummary(cart);
}

function getCurrentPrice({ productId, variantId }, sessionContext = {}) {
  const product = catalogService.getProductById(productId);
  if (!product) throw httpError('Product not found', 404);
  const variant = resolveProductVariant(product, variantId);
  if (!variant) throw httpError('Variant not found', 404);

  const originatingLiveSessionId = discountService.trustedLiveSessionId(sessionContext);
  const priced = discountService.evaluateLineItem({
    unitPrice: variant.price,
    quantity: 1,
    productId: product.id,
    originatingLiveSessionId,
  });

  return {
    productId: product.id,
    productName: product.name,
    variantId: variant.id,
    variantName: variant.name,
    currency: 'INR',
    price: priced.listPrice,
    listPrice: priced.listPrice,
    discountEligible: priced.discountEligible,
    discountPercent: priced.discountPercent,
    discountAmount: priced.discountAmount,
    effectivePrice: priced.effectiveUnitPrice,
    inStock: variant.inStock,
    originatingLiveSessionId: priced.originatingLiveSessionId,
    resolvedFromHint: variantId && variant.id !== variantId ? variant.id : undefined,
  };
}

function addToCart({ productId, variantId, quantity = 1 }, sessionContext = {}) {
  const product = catalogService.getProductById(productId);
  if (!product) throw httpError('Product not found', 404);
  const variant = resolveProductVariant(product, variantId);
  if (!variant) throw httpError('Variant not found', 404);

  const originatingLiveSessionId = discountService.trustedLiveSessionId(sessionContext);
  const shopperId = cartShopperId(sessionContext);
  const cart = cartService.addItem(shopperId, {
    productId,
    variantId: variant.id,
    quantity,
    originatingLiveSessionId,
  });
  const sessionKey = originatingLiveSessionId || null;
  const addedItem = cart.items.find(
    (item) =>
      item.productId === productId &&
      item.variantId === variant.id &&
      (item.originatingLiveSessionId || null) === sessionKey,
  );

  return {
    success: true,
    message: `Added ${product.name} (${variant.name}) to your cart`,
    variantId: variant.id,
    resolvedFromHint: variantId && variant.id !== variantId ? variant.id : undefined,
    originatingLiveSessionId: originatingLiveSessionId || null,
    discountEligible: addedItem ? Boolean(addedItem.discountEligible) : false,
    discountPercent: addedItem ? addedItem.discountPercent || 0 : 0,
    discountAmount: addedItem ? addedItem.discountAmount || 0 : 0,
    effectivePrice: addedItem ? addedItem.effectiveUnitPrice : variant.price,
    cart: mapCartSummary(cart),
  };
}

function removeFromCart({ productId } = {}, sessionContext = {}) {
  const shopperId = cartShopperId(sessionContext);
  const cart = cartService.getCart(shopperId);
  if (cart.items.length === 0) {
    return { success: false, message: 'Your cart is already empty.', cart: mapCartSummary(cart) };
  }

  let target = null;
  if (productId) {
    target = cart.items.find((item) => item.productId === productId);
  } else {
    target = cart.items[cart.items.length - 1];
  }

  if (!target) {
    const err = new Error('I could not find that item in your cart.');
    err.status = 404;
    throw err;
  }

  const updated = cartService.removeItem(shopperId, target.id);
  return {
    success: true,
    message: `Removed ${target.productName} from your cart`,
    removedProductId: target.productId,
    cart: mapCartSummary(updated),
  };
}

function checkoutOrder({ paymentMethod, deliveryPin } = {}, sessionContext = {}) {
  const shopperId = cartShopperId(sessionContext);
  const order = checkoutService.checkout({ paymentMethod, deliveryPin, shopperId });
  return {
    success: true,
    orderId: order.orderId,
    status: order.status,
    message: `Order ${order.orderId} confirmed. ${order.message}`,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal || 0,
    paymentMethod: order.paymentMethod,
    deliveryPin: order.deliveryPin || null,
    itemCount: order.items.length,
  };
}

function buildLiveContext(liveSessionId) {
  if (!liveSessionId) return null;
  const session = liveSessionService.getSessionById(liveSessionId);
  if (!session) return null;
  return {
    id: session.id,
    title: session.title,
    status: session.status,
    featuredProductId: session.featuredProductId,
    featuredProduct: session.featuredProduct,
    productIds: session.products.map((product) => product.id),
  };
}

// Execute the requested tool through the existing commerce service.
function executeTool(toolName, args, sessionContext = {}) {
  if (!ALLOWED_TOOL_NAMES.has(toolName)) {
    throw httpError(`Tool "${toolName}" is not allowed`, 400);
  }

  const input = validateToolInput(toolName, args);

  switch (toolName) {
    case 'searchProducts':
      return searchProducts(input);
    case 'getProduct':
      return getProduct(input);
    case 'compareProducts':
      return compareProducts(input);
    case 'checkServiceability':
      return checkServiceability(input);
    case 'getPaymentOptions':
      return getPaymentOptions();
    case 'getCart':
      return getCart(sessionContext);
    case 'getCurrentPrice':
      return getCurrentPrice(input, sessionContext);
    case 'addToCart':
      return addToCart(input, sessionContext);
    case 'removeFromCart':
      return removeFromCart(input, sessionContext);
    case 'checkout':
      return checkoutOrder(input, sessionContext);
    default:
      throw httpError(`Unsupported tool "${toolName}"`, 400);
  }
}

module.exports = {
  executeTool,
  buildLiveContext,
  searchProducts,
  getProduct,
  compareProducts,
  checkServiceability,
  getPaymentOptions,
  getCart,
  getCurrentPrice,
  addToCart,
  removeFromCart,
  checkoutOrder,
};
