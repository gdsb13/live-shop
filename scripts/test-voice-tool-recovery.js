#!/usr/bin/env node
'use strict';

const { executeTool } = require('../apps/api/src/services/aiToolService');
const discountService = require('../apps/api/src/services/discountService');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

const shopper = 'voice-recovery-test';

function ctx(overrides = {}) {
  return { shopperUserId: shopper, surface: 'storefront', ...overrides };
}

function assertRecoverable(result, code) {
  if (!result || result.success !== false || result.code !== code) {
    fail(`expected recoverable ${code}, got ${JSON.stringify(result)}`);
  }
}

function assertOk(result) {
  if (!result || result.success === false) {
    fail(`expected success, got ${JSON.stringify(result)}`);
  }
}

// A. product -> add -> checkout intent (missing payment stays recoverable)
assertOk(
  executeTool('searchProducts', { query: 'smart tv' }, ctx()),
);
const tvAdd = executeTool(
  'addToCart',
  { productId: 'elec-tv-samsung-55' },
  ctx(),
);
assertOk(tvAdd);
if (tvAdd.listPrice !== 32999) {
  fail(`addToCart listPrice should be default 43-inch price 32999, got ${tvAdd.listPrice}`);
}
assertRecoverable(executeTool('checkout', {}, ctx()), 'MISSING_PAYMENT_METHOD');
pass('A product -> add -> checkout recoverable without payment');

// B. product -> add -> another product -> add -> checkout recoverable
assertOk(
  executeTool(
    'addToCart',
    { productId: 'elec-headphones-sony', variantId: 'v-black', quantity: 1 },
    ctx(),
  ),
);
const cart = executeTool('getCart', {}, ctx());
assertOk(cart);
if (cart.itemCount !== 2 || cart.subtotal !== 59989) {
  fail(`expected cart total 59989 with 2 items, got ${JSON.stringify(cart)}`);
}
assertRecoverable(executeTool('checkout', {}, ctx()), 'MISSING_PAYMENT_METHOD');
pass('B multi-item cart checkout stays recoverable');

// C. payment selection path not executed yet; recoverable checkout still leaves cart intact
const pay = executeTool('getPaymentOptions', {}, ctx());
assertOk(pay);
pass('C payment options still available after recoverable checkout error');

// D. invalid/recoverable tool arguments return structured results
assertRecoverable(executeTool('searchProducts', {}, ctx()), 'MISSING_SEARCH_QUERY');
assertRecoverable(
  executeTool('compareProducts', { productIds: ['elec-headphones-sony'] }, ctx()),
  'INSUFFICIENT_PRODUCTS',
);
assertRecoverable(executeTool('checkServiceability', { pin: '12' }, ctx()), 'INVALID_PIN');
pass('D recoverable tool argument errors stay LLM-readable');

// E. after recoverable tool error, next user/tool turn still works
assertRecoverable(executeTool('checkout', {}, ctx()), 'MISSING_PAYMENT_METHOD');
const nextCart = executeTool('getCart', {}, ctx());
assertOk(nextCart);
if (nextCart.itemCount !== 2) {
  fail('getCart after recoverable checkout error should still work');
}
pass('E next tool call works after recoverable error');

const { normalizeProductId } = require('../apps/api/src/services/aiToolValidation');
if (normalizeProductId('OnePlus Nord 4 5G') !== 'elec-phone-oneplus') {
  fail('product name should resolve to catalog id');
}
const namedProduct = executeTool('getProduct', { productId: 'OnePlus Nord 4 5G' }, ctx());
assertOk(namedProduct);
if (!namedProduct.variantsSummary || namedProduct.variantCount !== 2) {
  fail(`getProduct by name should include variantsSummary, got ${JSON.stringify(namedProduct)}`);
}
pass('getProduct resolves spoken product names and returns variantsSummary');

const aiSessionStore = require('../apps/api/src/services/aiSessionStore');
const { runCommerceTool } = require('../apps/api/src/mcp/commerceToolRunner');
aiSessionStore.createSession({
  id: 'voice-recovery-discussed',
  channel: 'ai-voice-recovery-discussed',
  shopperUserId: shopper,
  surface: 'storefront',
  state: 'running',
  lastProductIds: [],
});
const voiceHeaders = { 'X-Voice-Channel': 'ai-voice-recovery-discussed' };
runCommerceTool('searchProducts', { query: 'mobile' }, voiceHeaders);
const variants = runCommerceTool('getProduct', {}, voiceHeaders);
assertOk(variants);
if (variants.id !== 'elec-phone-oneplus' || !variants.variantsSummary) {
  fail(`getProduct without productId should reuse last discussed product, got ${JSON.stringify(variants)}`);
}
pass('getProduct without productId uses last discussed product from search');

const placed = executeTool(
  'checkout',
  { paymentMethod: 'UPI', deliveryPin: 560001 },
  ctx(),
);
assertOk(placed);
if (!placed.orderId) {
  fail(`checkout with numeric PIN should return orderId, got ${JSON.stringify(placed)}`);
}
pass('checkout with numeric PIN and spoken UPI label succeeds');

// F. pricing consistency Store/LIVE/Replay
const storePrice = executeTool(
  'getCurrentPrice',
  { productId: 'elec-headphones-sony', variantId: 'v-black' },
  ctx({ surface: 'storefront' }),
);
assertOk(storePrice);
if (storePrice.effectivePrice !== 26990 || storePrice.discountEligible !== false) {
  fail(`store price should be full 26990, got ${JSON.stringify(storePrice)}`);
}

const liveSurfacePrice = executeTool(
  'getCurrentPrice',
  { productId: 'elec-headphones-sony', variantId: 'v-black' },
  ctx({ surface: 'live', liveSessionId: 'live-tech-tuesday' }),
);
assertOk(liveSurfacePrice);
if (liveSurfacePrice.discountEligible !== false || liveSurfacePrice.effectivePrice !== 26990) {
  fail(`LIVE surface without LIVE session status stays full price, got ${JSON.stringify(liveSurfacePrice)}`);
}

const replayAdd = executeTool(
  'addToCart',
  { productId: 'elec-headphones-sony', variantId: 'v-black', quantity: 1 },
  ctx({ surface: 'recorded', liveSessionId: 'live-tech-tuesday' }),
);
assertOk(replayAdd);
if (replayAdd.discountEligible !== false || replayAdd.effectivePrice !== 26990) {
  fail(`replay addToCart should not get live discount, got ${JSON.stringify(replayAdd)}`);
}
if (discountService.trustedLiveSessionId({ surface: 'recorded', liveSessionId: 'live-tech-tuesday' }) !== null) {
  fail('recorded surface must not attach trusted live session id');
}
pass('F pricing consistency Store/LIVE-not-started/Replay');

console.log('PASS: voice tool recovery scenarios');
