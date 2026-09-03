'use strict';

const { randomUUID } = require('crypto');
const aiToolService = require('./aiToolService');
const {
  ASSISTANT_FALLBACK_REPLY,
  buildSystemPrompt,
} = require('./aiAssistantConfig');
const { AI_TOOL_DEFINITIONS } = require('./aiToolDefinitions');

function getLastUserMessage(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user') {
      return typeof message.content === 'string' ? message.content : '';
    }
  }
  return '';
}

function extractPin(text) {
  const match = String(text).match(/\b[1-9][0-9]{5}\b/);
  return match ? match[0] : null;
}

function extractProductQuery(text) {
  return String(text)
    .toLowerCase()
    .replace(/^(please\s+)?(add|put)\s+(the\s+)?/i, '')
    .replace(/\s+to\s+(my\s+)?cart.*$/i, '')
    .replace(/how much is\s+(the\s+)?/i, '')
    .replace(/\?+$/, '')
    .trim();
}

function findProductByHint(text, sessionContext) {
  const haystack = String(text).toLowerCase();
  const queryHint = extractProductQuery(text);
  const candidates = [];

  if (sessionContext.productId) {
    const current = aiToolService.getProduct({ productId: sessionContext.productId });
    candidates.push(current);
  }

  if (sessionContext.liveContext && sessionContext.liveContext.featuredProduct) {
    candidates.push(
      aiToolService.getProduct({ productId: sessionContext.liveContext.featuredProduct.id }),
    );
  }

  for (const productId of sessionContext.lastProductIds || []) {
    try {
      candidates.push(aiToolService.getProduct({ productId }));
    } catch {
      // ignore stale ids
    }
  }

  const searchQueries = [queryHint, haystack];
  const hintTokens = ['sony', 'samsung', 'oneplus', 'headphones', 'television', 'tv', '55 inch', '55-inch'];
  for (const token of hintTokens) {
    if (haystack.includes(token) && !searchQueries.includes(token)) {
      searchQueries.push(token);
    }
  }

  for (const query of searchQueries) {
    if (!query) continue;
    const search = aiToolService.searchProducts({ query });
    for (const product of search.products) {
      candidates.push(aiToolService.getProduct({ productId: product.id }));
    }
  }

  const unique = new Map(candidates.map((product) => [product.id, product]));
  for (const product of unique.values()) {
    const brand = product.brand.toLowerCase();
    const name = product.name.toLowerCase();
    if (haystack.includes(brand) || haystack.includes(name) || queryHint.includes(brand)) {
      return product;
    }
  }
  return unique.values().next().value || null;
}

function normalizeUtterance(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CATEGORY_HINTS = [
  { pattern: /smart\s*tv|television|\btv\b/, query: 'smart tv' },
  { pattern: /headphone|earphone|earbud|noise cancel/, query: 'headphones' },
  { pattern: /phone|smartphone|mobile/, query: 'phone' },
  { pattern: /tablet|ipad/, query: 'tablet' },
  { pattern: /laptop|notebook/, query: 'laptop' },
  { pattern: /watch|smartwatch/, query: 'watch' },
];

const BRAND_HINTS = ['sony', 'samsung', 'oneplus', 'apple', 'mi', 'lg', 'boat', 'nike'];

function extractSearchKeywords(text) {
  const normalized = normalizeUtterance(text);
  if (!normalized) return null;

  for (const hint of CATEGORY_HINTS) {
    if (hint.pattern.test(normalized)) return hint.query;
  }

  for (const brand of BRAND_HINTS) {
    if (new RegExp(`\\b${brand}\\b`).test(normalized)) return brand;
  }

  const stripped = normalized
    .replace(
      /\b(can you|could you|would you|help me|please|i want|i need|select|choose|show|find|search for|looking for|your|any|some|me|a|an|the)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();

  if (stripped && stripped.split(/\s+/).length <= 4) {
    return stripped;
  }

  return null;
}

function isEndSessionIntent(text) {
  return (
    /^(disconnect|end call|hang up|stop assistant|i am done|i'?m done|im done|that is all|that'?s all|bye|goodbye|stop listening|close assistant|thank you bye)$/.test(
      text,
    ) || /disconnect the call|end the call|i am done|i'?m done|im done/.test(text)
  );
}

function isFollowUpAlternatives(text) {
  return /other option|another option|anything else|what else|other tv|alternatives|more options|other one|something else/.test(
    text,
  );
}

function isRemoveFromCartIntent(text) {
  return (
    (/remove|delete|take out|drop/.test(text) && /cart|it|that|this/.test(text)) ||
    /^remove it$/.test(text)
  );
}

function isSearchMetaPrompt(text) {
  if (extractSearchKeywords(text)) return false;
  const normalized = normalizeUtterance(text);
  if (!normalized) return false;
  return (
    /^(i want to|can you|please|help me)?\s*(search|browse|look for|find|show me)/.test(normalized) ||
    /^(search|browse|shop)$/.test(normalized)
  );
}

function resolveContextProduct(sessionContext) {
  const productId = sessionContext.lastProductIds && sessionContext.lastProductIds[0];
  if (!productId) return null;
  try {
    return aiToolService.getProduct({ productId });
  } catch {
    return null;
  }
}

function buildSearchPlan(query, sessionContext) {
  const cleaned = normalizeUtterance(query);
  sessionContext.lastSearchQuery = cleaned;
  return {
    toolName: 'searchProducts',
    args: { query: cleaned },
    rememberFromTool: 'products',
    clearAwaitingSearch: true,
    formatter: (result) => {
      if (result.count === 0) {
        return `I could not find products matching "${cleaned}". Try a brand like Sony or OnePlus, or say smart TV or headphones.`;
      }
      const top = result.products
        .slice(0, 3)
        .map((product) => `${product.name} from ${formatCurrencyInr(product.priceFrom)}`)
        .join('. ');
      return `I found ${result.count} option(s). Top matches: ${top}.`;
    },
  };
}

function buildAlternativesReply(sessionContext) {
  const query = sessionContext.lastSearchQuery || 'smart tv';
  const search = aiToolService.searchProducts({ query });
  const shown = new Set(sessionContext.lastProductIds || []);
  const others = search.products.filter((product) => !shown.has(product.id));

  if (others.length > 0) {
    const names = others
      .slice(0, 3)
      .map((product) => `${product.name} from ${formatCurrencyInr(product.priceFrom)}`)
      .join('. ');
    return {
      reply: `Here are other options: ${names}.`,
      rememberProductIds: others.map((product) => product.id),
    };
  }

  if (shown.size === 1) {
    const product = resolveContextProduct(sessionContext);
    if (product && product.variants.length > 1) {
      const variantNames = product.variants.map((variant) => variant.name).join(', ');
      return {
        reply: `I only have one ${query} model right now — ${product.name}. It comes in ${variantNames}. Want a price on a specific size?`,
      };
    }
  }

  return {
    reply: `I only have ${search.count} option(s) in that category right now. Want to try another category like headphones or phones?`,
  };
}

function formatCurrencyInr(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function runMockToolPlan(userText, sessionContext) {
  const text = normalizeUtterance(userText);

  if (isEndSessionIntent(text)) {
    return {
      reply: 'Okay, ending our conversation. Have a great day!',
      endSession: true,
    };
  }

  if (isRemoveFromCartIntent(text)) {
    const useLastCartItem = /it|this|that|from my cart/.test(text);
    const product = useLastCartItem ? null : findProductByHint(userText, sessionContext);
    return {
      toolName: 'removeFromCart',
      args: product ? { productId: product.id } : {},
      cartUpdated: true,
      formatter: (result) => {
        if (!result.success) return result.message;
        return `${result.message}. Your cart now has ${result.cart.itemCount} item(s).`;
      },
    };
  }

  if (isFollowUpAlternatives(text)) {
    return buildAlternativesReply(sessionContext);
  }

  if (/add .*cart|put .*cart|add to cart|^add it/.test(text)) {
    let product = null;
    if (/^(add )?(it|this|that)(\s+to(\s+my)?\s+cart)?$/.test(text)) {
      product = resolveContextProduct(sessionContext);
    }
    if (!product) {
      product = findProductByHint(userText, sessionContext);
    }
    if (!product) {
      return {
        reply: 'I could not tell which product to add. Please name the product clearly.',
      };
    }
    const variant =
      product.variants.find((item) => /55/.test(userText) && /55/.test(item.name)) ||
      product.variants.find((item) => item.inStock) ||
      product.variants[0];
    return {
      toolName: 'addToCart',
      args: {
        productId: product.id,
        variantId: variant.id,
        quantity: 1,
      },
      formatter: (result) =>
        `Done. I added ${product.name} (${variant.name}) to your cart. Your cart now has ${result.cart.itemCount} item(s).`,
      rememberProductIds: [product.id],
      cartUpdated: true,
    };
  }

  if (/compare/.test(text)) {
    const search = aiToolService.searchProducts({ query: userText });
    const ids = search.products.slice(0, 2).map((product) => product.id);
    if (ids.length < 2) {
      return { reply: 'I need at least two products to compare. Try naming both products.' };
    }
    return {
      toolName: 'compareProducts',
      args: { productIds: ids },
      formatter: (result) => {
        const summary = result.products
          .map(
            (product) =>
              `${product.name} at ${formatCurrencyInr(Math.min(...product.variants.map((variant) => variant.price)))}`,
          )
          .join(' versus ');
        return `Here is a quick comparison: ${summary}.`;
      },
      rememberProductIds: ids,
    };
  }

  if (/how much|price|cost/.test(text)) {
    const product = findProductByHint(userText, sessionContext);
    if (!product) {
      return { reply: 'Tell me which product you want priced and I will check the catalogue.' };
    }
    const variant =
      product.variants.find((item) => /55/.test(userText) && /55/.test(item.name)) ||
      product.variants.find((item) => item.inStock) ||
      product.variants[0];
    return {
      toolName: 'getCurrentPrice',
      args: { productId: product.id, variantId: variant.id },
      formatter: (result) =>
        `${result.productName} (${result.variantName}) is ${formatCurrencyInr(result.price)}.`,
      rememberProductIds: [product.id],
    };
  }

  if (/payment option|payment method|how (can|do) i pay|ways? to pay|pay by|cash on delivery/.test(text)) {
    return {
      toolName: 'getPaymentOptions',
      args: {},
      formatter: (result) => {
        const labels = result.options.slice(0, 3).map((option) => option.label).join(', ');
        return `We accept ${labels}, and more at checkout.`;
      },
    };
  }

  const pin = extractPin(userText);
  if (pin || /deliver|delivery|serviceable|pin code|pincode/.test(text)) {
    return {
      toolName: 'checkServiceability',
      args: { pin: pin || '201014' },
      formatter: (result) => result.message,
    };
  }

  if (isSearchMetaPrompt(text)) {
    sessionContext.awaitingSearchQuery = true;
    return {
      reply: 'Sure — what are you looking for? You can say smart TV, headphones, or OnePlus phone.',
    };
  }

  const searchKeywords = extractSearchKeywords(text);
  if (searchKeywords) {
    return buildSearchPlan(searchKeywords, sessionContext);
  }

  if (sessionContext.awaitingSearchQuery && text) {
    return buildSearchPlan(text, sessionContext);
  }

  if (/headphone|noise cancel/.test(text)) {
    return buildSearchPlan('headphones', sessionContext);
  }

  return {
    reply: ASSISTANT_FALLBACK_REPLY,
  };
}

function resultProductsIds(result) {
  return (result.products || []).map((product) => product.id);
}

function runMockAgentTurn(messages, sessionContext) {
  const userText = getLastUserMessage(messages);
  const plan = runMockToolPlan(userText, sessionContext);

  if (plan.reply) {
    return {
      reply: plan.reply,
      cartUpdated: false,
      lastProductIds: plan.rememberProductIds || sessionContext.lastProductIds || [],
      endSession: Boolean(plan.endSession),
    };
  }

  const toolResult = aiToolService.executeTool(plan.toolName, plan.args, sessionContext);
  const reply = plan.formatter(toolResult);
  if (plan.clearAwaitingSearch) {
    sessionContext.awaitingSearchQuery = false;
  }
  const remembered =
    plan.rememberProductIds ||
    (plan.rememberFromTool === 'products' ? resultProductsIds(toolResult) : []) ||
    sessionContext.lastProductIds ||
    [];
  return {
    reply,
    cartUpdated: Boolean(plan.cartUpdated),
    lastProductIds: remembered,
    endSession: Boolean(plan.endSession),
  };
}

function sseChunk(content, model) {
  const payload = {
    id: `chatcmpl-${randomUUID()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: { content },
        finish_reason: null,
      },
    ],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function sseDone() {
  return 'data: [DONE]\n\n';
}

function validateLlmAuth(req) {
  const expected = process.env.AI_CUSTOM_LLM_API_KEY || 'live-shop-ai-key';
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || token !== expected) {
    const err = new Error('Unauthorized custom LLM request');
    err.status = 401;
    throw err;
  }
}

async function handleChatCompletions(req, res) {
  validateLlmAuth(req);
  const { messages = [], model = 'live-shop-commerce', stream = true } = req.body || {};
  const sessionContext = req.aiSessionContext || {
    surface: 'storefront',
    lastProductIds: [],
  };

  const turn = runMockAgentTurn(messages, sessionContext);
  req.aiTurnMeta = {
    cartUpdated: turn.cartUpdated,
    lastProductIds: turn.lastProductIds,
    reply: turn.reply,
  };

  if (!stream) {
    res.json({
      id: `chatcmpl-${randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: turn.reply },
          finish_reason: 'stop',
        },
      ],
    });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(sseChunk(turn.reply, model));
  res.write(sseDone());
  res.end();
}

module.exports = {
  AI_TOOL_DEFINITIONS,
  buildSystemPrompt,
  handleChatCompletions,
  runMockAgentTurn,
  validateLlmAuth,
};
