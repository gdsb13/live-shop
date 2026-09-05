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
const { validateToolInput, normalizePaymentMethod } = require('./aiToolValidation');
const { recoverableToolError } = require('./toolResult');

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
  const normalizedQuery = String(query || '').trim();
  const normalizedCategory = String(category || '').trim();
  if (!normalizedQuery && !normalizedCategory) {
    return recoverableToolError(
      'MISSING_SEARCH_QUERY',
      "A search query is required. Infer a query from the user's current request and call searchProducts again.",
    );
  }

  const products = catalogService.listProducts({
    search: normalizedQuery || undefined,
    category: normalizedCategory || undefined,
  });
  return {
    count: products.length,
    products: products.slice(0, 5),
  };
}

function compareProducts({ productIds }) {
  if (productIds !== undefined && !Array.isArray(productIds)) {
    return recoverableToolError(
      'INVALID_PRODUCT_IDS',
      'compareProducts productIds must be an array of product ids.',
    );
  }

  const ids = Array.isArray(productIds)
    ? productIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];

  if (ids.length < 2) {
    return recoverableToolError(
      'INSUFFICIENT_PRODUCTS',
      'At least two products are required for comparison. Search the catalog for an alternative first.',
    );
  }

  const products = catalogService.getProductsForComparison(ids);
  if (products.length < 2) {
    return recoverableToolError(
      'INSUFFICIENT_PRODUCTS',
      'At least two products are required for comparison. Search the catalog for an alternative first.',
    );
  }

  return { products };
}

function getProduct({ productId }) {
  const resolvedProductId = catalogService.resolveProductId(productId);
  if (!resolvedProductId) {
    return recoverableToolError(
      'MISSING_PRODUCT_ID',
      'getProduct requires a productId. Search the catalog or reuse the last discussed product id.',
    );
  }

  const product = catalogService.getProductById(resolvedProductId);
  if (!product) {
    return recoverableToolError(
      'PRODUCT_NOT_FOUND',
      'That product was not found. Search the catalog again for a valid product id.',
    );
  }

  const defaultVariant = pickDefaultVariant(product);
  const variants = product.variants.map((variant) => ({
    id: variant.id,
    name: variant.name,
    price: variant.price,
    inStock: variant.inStock,
    attributes: variant.attributes,
  }));
  return {
    id: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    description: product.description,
    rating: product.rating,
    variantCount: product.variants.length,
    variants,
    variantsSummary: variants
      .map((variant) => `${variant.name} (₹${variant.price.toLocaleString('en-IN')})`)
      .join('; '),
    defaultVariantId: defaultVariant ? defaultVariant.id : null,
    defaultVariantName: defaultVariant ? defaultVariant.name : null,
    defaultVariantPrice: defaultVariant ? defaultVariant.price : null,
  };
}

function checkServiceability({ pin }) {
  if (!/^[1-9][0-9]{5}$/.test(String(pin || ''))) {
    return recoverableToolError(
      'INVALID_PIN',
      'A valid six-digit Indian PIN code is required. Ask the shopper for their PIN and try again.',
    );
  }

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
  if (!productId || typeof productId !== 'string') {
    return recoverableToolError(
      'MISSING_PRODUCT_ID',
      'getCurrentPrice requires a productId. Search the catalog or reuse the last discussed product id.',
    );
  }

  const product = catalogService.getProductById(productId);
  if (!product) {
    return recoverableToolError(
      'PRODUCT_NOT_FOUND',
      'That product was not found. Search the catalog again for a valid product id.',
    );
  }

  const variant = resolveProductVariant(product, variantId);
  if (!variant) {
    return recoverableToolError(
      'VARIANT_NOT_FOUND',
      'That variant was not found. Call getProduct for valid variant ids or omit variantId for the default.',
    );
  }

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
  if (!productId || typeof productId !== 'string') {
    return recoverableToolError(
      'MISSING_PRODUCT_ID',
      'addToCart requires a productId. Search the catalog or reuse the last discussed product id.',
    );
  }

  const product = catalogService.getProductById(productId);
  if (!product) {
    return recoverableToolError(
      'PRODUCT_NOT_FOUND',
      'That product was not found. Search the catalog again before adding to cart.',
    );
  }

  const variant = resolveProductVariant(product, variantId);
  if (!variant) {
    return recoverableToolError(
      'VARIANT_NOT_FOUND',
      'That variant was not found. Call getProduct for valid variant ids or omit variantId for the default.',
    );
  }

  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
    return recoverableToolError(
      'INVALID_QUANTITY',
      'addToCart quantity must be an integer between 1 and 10.',
    );
  }

  const originatingLiveSessionId = discountService.trustedLiveSessionId(sessionContext);
  const shopperId = cartShopperId(sessionContext);
  const cart = cartService.addItem(shopperId, {
    productId,
    variantId: variant.id,
    quantity: qty,
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
    productId: product.id,
    productName: product.name,
    variantId: variant.id,
    variantName: variant.name,
    listPrice: addedItem ? addedItem.listPrice : variant.price,
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
    return recoverableToolError(
      'CART_ITEM_NOT_FOUND',
      'I could not find that item in your cart. Call getCart to review current items.',
      { cart: mapCartSummary(cart) },
    );
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
  const cart = cartService.getCart(shopperId);

  if (!cart.items.length) {
    return recoverableToolError(
      'EMPTY_CART',
      'The cart is empty. Add items before attempting checkout.',
      { cart: mapCartSummary(cart) },
    );
  }

  const normalizedPaymentMethod = normalizePaymentMethod(paymentMethod);
  if (!normalizedPaymentMethod || !['upi', 'card', 'cod'].includes(normalizedPaymentMethod)) {
    return recoverableToolError(
      paymentMethod ? 'INVALID_PAYMENT_METHOD' : 'MISSING_PAYMENT_METHOD',
      paymentMethod
        ? 'Payment method must be upi, card, or cod. Call getPaymentOptions and ask the shopper to choose.'
        : 'Payment method is required before checkout. Call getPaymentOptions and ask which method the shopper prefers.',
      { cart: mapCartSummary(cart) },
    );
  }

  if (deliveryPin !== undefined && deliveryPin !== null && String(deliveryPin).trim() !== '') {
    if (!/^[1-9][0-9]{5}$/.test(String(deliveryPin))) {
      return recoverableToolError(
        'INVALID_PIN',
        'deliveryPin must be a valid six-digit Indian PIN when provided.',
        { cart: mapCartSummary(cart) },
      );
    }
  }

  try {
    const order = checkoutService.checkout({
      paymentMethod: normalizedPaymentMethod,
      deliveryPin,
      shopperId,
    });

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
  } catch (err) {
    return recoverableToolError(
      'CHECKOUT_FAILED',
      err.message || 'Checkout could not be completed. Ask the shopper to try again.',
      { cart: mapCartSummary(cart) },
    );
  }
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
  try {
    if (!ALLOWED_TOOL_NAMES.has(toolName)) {
      return recoverableToolError('UNKNOWN_TOOL', `Tool "${toolName}" is not allowed`);
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
        return recoverableToolError('UNKNOWN_TOOL', `Unsupported tool "${toolName}"`);
    }
  } catch (err) {
    return recoverableToolError(
      'TOOL_EXECUTION_FAILED',
      err.message || 'Tool execution failed',
    );
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
