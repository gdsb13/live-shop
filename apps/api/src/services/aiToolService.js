'use strict';

const catalogService = require('./catalogService');
const cartService = require('./cartService');
const serviceabilityService = require('./serviceabilityService');
const paymentOptionsService = require('./paymentOptionsService');
const liveSessionService = require('./liveSessionService');
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

function getCurrentPrice({ productId, variantId }) {
  const product = catalogService.getProductById(productId);
  if (!product) throw httpError('Product not found', 404);
  const variant = catalogService.getVariant(product, variantId);
  if (!variant) throw httpError('Variant not found', 404);
  return {
    productId: product.id,
    productName: product.name,
    variantId: variant.id,
    variantName: variant.name,
    currency: 'INR',
    price: variant.price,
    inStock: variant.inStock,
  };
}

function addToCart({ productId, variantId, quantity = 1 }) {
  const cart = cartService.addItem({ productId, variantId, quantity });
  // Cart mutation succeeded; caller can notify the frontend to refresh visible cart.
  return {
    success: true,
    message: 'Item added to cart',
    cart: {
      itemCount: cart.itemCount,
      subtotal: cart.subtotal,
      currency: cart.currency,
      items: cart.items,
    },
  };
}

function removeFromCart({ productId } = {}) {
  const cart = cartService.getCart();
  if (cart.items.length === 0) {
    return { success: false, message: 'Your cart is already empty.', cart };
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

  const updated = cartService.removeItem(target.id);
  return {
    success: true,
    message: `Removed ${target.productName} from your cart`,
    removedProductId: target.productId,
    cart: {
      itemCount: updated.itemCount,
      subtotal: updated.subtotal,
      currency: updated.currency,
      items: updated.items,
    },
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
    case 'getCurrentPrice':
      return getCurrentPrice(input);
    case 'addToCart':
      return addToCart(input);
    case 'removeFromCart':
      return removeFromCart(input);
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
  getCurrentPrice,
  addToCart,
  removeFromCart,
};
