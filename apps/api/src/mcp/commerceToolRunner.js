'use strict';

const aiSessionStore = require('../services/aiSessionStore');
const { executeTool } = require('../services/aiToolService');
const { ALLOWED_TOOL_NAMES } = require('../services/aiToolDefinitions');
const { getMcpRequestHeaders } = require('./mcpRequestContext');
const { recoverableToolError } = require('../services/toolResult');

function productIdsFromToolResult(toolName, result) {
  if (!result || typeof result !== 'object' || result.success === false) return [];

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
  const discussedProductId =
    sessionContext.lastDiscussedProductId || sessionContext.lastProductId || null;

  if (toolName === 'getProduct' && !next.productId) {
    if (sessionContext.productId) {
      next.productId = sessionContext.productId;
    } else if (discussedProductId) {
      next.productId = discussedProductId;
    } else if (Array.isArray(sessionContext.lastProductIds) && sessionContext.lastProductIds[0]) {
      next.productId = sessionContext.lastProductIds[0];
    }
  }

  if (toolName === 'getCurrentPrice' && !next.productId) {
    if (discussedProductId) {
      next.productId = discussedProductId;
    }
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
    if (!next.paymentMethod && sessionContext.lastPaymentMethod) {
      next.paymentMethod = sessionContext.lastPaymentMethod;
    }
  }

  return next;
}

function logToolLifecycle(event, toolName, sessionContext, detail = {}) {
  const timestamp = new Date().toISOString();
  const sessionId = sessionContext.id || 'unknown';
  const channel = sessionContext.channel || 'unknown';
  console.log(
    `[VoiceAI] ${timestamp} session=${sessionId} channel=${channel} tool=${toolName} event=${event}`,
    JSON.stringify(detail),
  );
}

function summarizeToolResult(result, err) {
  if (err) {
    return {
      status: 'error',
      httpStatus: err.status || 500,
      message: err.message || 'Tool execution failed',
    };
  }
  if (result && result.success === false) {
    return {
      status: 'recoverable',
      code: result.code || 'TOOL_INPUT_ERROR',
      message: result.message || 'Recoverable tool input error',
    };
  }
  return { status: 'ok' };
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

  logToolLifecycle('tool_call_requested', toolName, sessionContext, enrichedArgs);

  let result;
  try {
    result = executeTool(toolName, enrichedArgs, sessionContext);
    logToolLifecycle(
      'tool_call_completed',
      toolName,
      sessionContext,
      summarizeToolResult(result),
    );
  } catch (err) {
    logToolLifecycle('tool_call_failed', toolName, sessionContext, summarizeToolResult(null, err));
    result = recoverableToolError(
      'TOOL_EXECUTION_FAILED',
      err.message || 'Tool execution failed',
    );
  }

  if (toolName === 'getProduct' && result && result.id) {
    sessionContext.lastDiscussedProductId = result.id;
    sessionContext.lastProductId = result.id;
    if (result.defaultVariantId) {
      sessionContext.lastVariantId = result.defaultVariantId;
    }
  }
  if (toolName === 'getCurrentPrice' && result && result.productId && result.success !== false) {
    sessionContext.lastDiscussedProductId = result.productId;
    sessionContext.lastProductId = result.productId;
    sessionContext.lastVariantId = result.variantId;
  }

  if (toolName === 'checkServiceability' && result && result.serviceable && result.pin) {
    sessionContext.lastDeliveryPin = result.pin;
    if (sessionContext.id) {
      aiSessionStore.updateSession(sessionContext.id, sessionContext);
    }
  }

  if (toolName === 'checkout' && enrichedArgs.paymentMethod) {
    const { normalizePaymentMethod } = require('../services/aiToolValidation');
    const method = normalizePaymentMethod(enrichedArgs.paymentMethod);
    if (['upi', 'card', 'cod'].includes(method)) {
      sessionContext.lastPaymentMethod = method;
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
    logToolLifecycle('cart_mutation_ok', toolName, sessionContext, {
      orderId: result.orderId || null,
    });
  }

  const remembered = productIdsFromToolResult(toolName, result);
  if (remembered.length > 0 && sessionContext.id) {
    sessionContext.lastProductIds = remembered;
    if (toolName === 'searchProducts') {
      sessionContext.lastDiscussedProductId = remembered[0];
    }
    sessionContext.lastProductId = remembered[0];
    aiSessionStore.updateSession(sessionContext.id, sessionContext);
  } else if (sessionContext.id && (sessionContext.lastDiscussedProductId || sessionContext.lastProductId)) {
    aiSessionStore.updateSession(sessionContext.id, sessionContext);
  }

  return result;
}

module.exports = {
  runCommerceTool,
  resolveSessionContext,
};
