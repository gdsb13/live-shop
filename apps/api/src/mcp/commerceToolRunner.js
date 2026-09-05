'use strict';

const aiSessionStore = require('../services/aiSessionStore');
const { executeTool } = require('../services/aiToolService');
const { ALLOWED_TOOL_NAMES } = require('../services/aiToolDefinitions');
const { getMcpRequestHeaders } = require('./mcpRequestContext');

function productIdsFromToolResult(toolName, result) {
  if (!result || typeof result !== 'object') return [];

  if (toolName === 'searchProducts' && Array.isArray(result.products)) {
    return result.products.map((product) => product.id).filter(Boolean);
  }
  if (toolName === 'getProduct' && result.id) {
    return [result.id];
  }
  if (toolName === 'compareProducts' && Array.isArray(result.products)) {
    return result.products.map((product) => product.id).filter(Boolean);
  }
  if (toolName === 'getCurrentPrice' && result.productId) {
    return [result.productId];
  }
  return [];
}

function resolveSessionContext(headers) {
  const activeHeaders = headers || getMcpRequestHeaders();
  const channel =
    (activeHeaders &&
      (activeHeaders['x-voice-channel'] ||
        activeHeaders['X-Voice-Channel'] ||
        activeHeaders['x-voice-channel'.toLowerCase()])) ||
    '';

  if (channel) {
    const byChannel = aiSessionStore.getSessionByChannel(String(channel));
    if (byChannel) return byChannel;
  }

  const running = aiSessionStore.listRunningSessions();
  if (running.length === 1) {
    return running[0];
  }
  return null;
}

function enrichToolArgs(toolName, args, sessionContext) {
  const next = { ...(args || {}) };

  if (toolName === 'getProduct' && !next.productId) {
    if (sessionContext.productId) {
      next.productId = sessionContext.productId;
    } else if (sessionContext.lastProductId) {
      next.productId = sessionContext.lastProductId;
    } else if (Array.isArray(sessionContext.lastProductIds) && sessionContext.lastProductIds[0]) {
      next.productId = sessionContext.lastProductIds[0];
    }
  }

  if (toolName === 'getCurrentPrice' && !next.productId && sessionContext.lastProductId) {
    next.productId = sessionContext.lastProductId;
  }
  if (toolName === 'getCurrentPrice' && !next.variantId && sessionContext.lastVariantId) {
    next.variantId = sessionContext.lastVariantId;
  }

  if (toolName === 'addToCart') {
    if (!next.productId && sessionContext.lastProductId) {
      next.productId = sessionContext.lastProductId;
    }
    if (!next.variantId && sessionContext.lastVariantId) {
      next.variantId = sessionContext.lastVariantId;
    }
  }

  if (toolName === 'removeFromCart' && !next.productId && sessionContext.lastProductId) {
    next.productId = sessionContext.lastProductId;
  }

  if (toolName === 'checkout') {
    if (!next.deliveryPin && sessionContext.lastDeliveryPin) {
      next.deliveryPin = sessionContext.lastDeliveryPin;
    }
  }

  return next;
}

// MCP adapter: validate and dispatch one allowlisted commerce tool.
function runCommerceTool(toolName, args, headers) {
  if (!ALLOWED_TOOL_NAMES.has(toolName)) {
    const err = new Error(`Tool "${toolName}" is not allowed`);
    err.status = 400;
    throw err;
  }

  const sessionContext = resolveSessionContext(headers) || {
    surface: 'storefront',
    lastProductIds: [],
  };

  const enrichedArgs = enrichToolArgs(toolName, args, sessionContext);

  sessionContext.lastActivityAt = new Date().toISOString();
  if (sessionContext.id) {
    aiSessionStore.updateSession(sessionContext.id, sessionContext);
  }

  console.log(
    `[VoiceAI] MCP tool requested: ${toolName}`,
    JSON.stringify(enrichedArgs),
    `channel=${sessionContext.channel || 'unknown'}`,
  );

  let result;
  try {
    result = executeTool(toolName, enrichedArgs, sessionContext);
    console.log('[VoiceAI] MCP tool result: success');
  } catch (err) {
    console.log(`[VoiceAI] MCP tool result: error (${err.message})`);
    throw err;
  }

  if (toolName === 'getProduct' && result && result.id) {
    sessionContext.lastProductId = result.id;
    if (result.defaultVariantId) {
      sessionContext.lastVariantId = result.defaultVariantId;
    }
  }
  if (toolName === 'getCurrentPrice' && result && result.variantId) {
    sessionContext.lastProductId = result.productId;
    sessionContext.lastVariantId = result.variantId;
  }

  if (toolName === 'checkServiceability' && result && result.serviceable && result.pin) {
    sessionContext.lastDeliveryPin = result.pin;
    if (sessionContext.id) {
      aiSessionStore.updateSession(sessionContext.id, sessionContext);
    }
  }

  if ((toolName === 'addToCart' || toolName === 'removeFromCart' || toolName === 'checkout') && result && result.success) {
    if (sessionContext.id) {
      sessionContext.cartUpdated = true;
      if (toolName === 'checkout' && result.orderId) {
        sessionContext.orderCompleted = true;
        sessionContext.lastOrderId = result.orderId;
      }
      aiSessionStore.updateSession(sessionContext.id, sessionContext);
    }
    console.log('[VoiceAI] Cart mutation: success');
  }

  const remembered = productIdsFromToolResult(toolName, result);
  if (remembered.length > 0 && sessionContext.id) {
    sessionContext.lastProductIds = remembered;
    sessionContext.lastProductId = remembered[0];
    aiSessionStore.updateSession(sessionContext.id, sessionContext);
  }

  return result;
}

module.exports = {
  runCommerceTool,
  resolveSessionContext,
};
