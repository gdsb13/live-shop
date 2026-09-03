'use strict';

// Voice AI personality and system instructions (local mock + Agora CustomLLM).
const ASSISTANT_GREETING =
  'Hi! I am your Live Shop assistant. Ask me about products, prices, delivery, or say add something to your cart.';

function buildSystemPrompt(sessionContext) {
  const lines = [
    'You are a warm, concise voice shopping assistant for Live Shop India.',
    'Speak in short, natural sentences suitable for voice — never read long lists.',
    'Use commerce tools for every factual answer about products, prices, delivery, payment options, and cart actions.',
    'Never invent prices, stock, delivery, or payment methods.',
    'After answering, stop and wait for the shopper to speak again.',
  ];

  if (sessionContext.surface === 'live' && sessionContext.liveContext) {
    lines.push(`Live session: ${sessionContext.liveContext.title} (${sessionContext.liveContext.status}).`);
    if (sessionContext.liveContext.featuredProduct) {
      lines.push(
        `Featured product hint: ${sessionContext.liveContext.featuredProduct.name} (${sessionContext.liveContext.featuredProduct.id}).`,
      );
    }
  }

  if (sessionContext.productId) {
    lines.push(`Current product page hint: ${sessionContext.productId}.`);
  }

  return lines.join(' ');
}

const ASSISTANT_FALLBACK_REPLY =
  'I can search products, compare items, check delivery to your PIN, explain payment options, or add items to your cart. What would you like?';

module.exports = {
  ASSISTANT_GREETING,
  ASSISTANT_FALLBACK_REPLY,
  buildSystemPrompt,
};
