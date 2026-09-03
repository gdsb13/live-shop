'use strict';

// Define the commerce tools the AI is allowed to call.
const AI_TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'searchProducts',
      description: 'Search the store catalogue by keyword, category, or feature.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search text such as brand, feature, or product type.' },
          category: { type: 'string', description: 'Optional category filter.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getProduct',
      description: 'Get full product details including variants and specifications.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string' },
        },
        required: ['productId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compareProducts',
      description: 'Compare two or more products by id.',
      parameters: {
        type: 'object',
        properties: {
          productIds: {
            type: 'array',
            items: { type: 'string' },
            minItems: 2,
            maxItems: 4,
          },
        },
        required: ['productIds'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'checkServiceability',
      description: 'Check whether delivery is available to an Indian PIN code.',
      parameters: {
        type: 'object',
        properties: {
          pin: { type: 'string', description: 'Six-digit Indian PIN code.' },
        },
        required: ['pin'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getPaymentOptions',
      description: 'List available payment methods for checkout.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getCurrentPrice',
      description: 'Get authoritative price for a product variant in INR.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string' },
          variantId: { type: 'string' },
        },
        required: ['productId', 'variantId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addToCart',
      description: 'Add a product variant to the shopper cart.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string' },
          variantId: { type: 'string' },
          quantity: { type: 'integer', minimum: 1, maximum: 10 },
        },
        required: ['productId', 'variantId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'removeFromCart',
      description: 'Remove a product from the shopper cart by product id or last added item.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'Optional. Removes matching product; defaults to last discussed item.' },
        },
      },
    },
  },
];

const ALLOWED_TOOL_NAMES = new Set(
  AI_TOOL_DEFINITIONS.map((tool) => tool.function.name),
);

module.exports = {
  AI_TOOL_DEFINITIONS,
  ALLOWED_TOOL_NAMES,
};
