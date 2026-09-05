'use strict';

const z = require('zod/v4');
const { AI_TOOL_DEFINITIONS } = require('../services/aiToolDefinitions');
const { runCommerceTool } = require('./commerceToolRunner');

function jsonSchemaPropertyToZod(propertySchema, isRequired) {
  let schema;

  if (propertySchema.type === 'array') {
    const itemSchema = propertySchema.items || { type: 'string' };
    schema = z.array(jsonSchemaPropertyToZod(itemSchema, true));
    if (propertySchema.minItems != null) {
      schema = schema.min(propertySchema.minItems);
    }
    if (propertySchema.maxItems != null) {
      schema = schema.max(propertySchema.maxItems);
    }
  } else if (propertySchema.type === 'integer') {
    schema = z.number().int();
    if (propertySchema.minimum != null) {
      schema = schema.min(propertySchema.minimum);
    }
    if (propertySchema.maximum != null) {
      schema = schema.max(propertySchema.maximum);
    }
  } else {
    schema = z.string();
  }

  if (propertySchema.description) {
    schema = schema.describe(propertySchema.description);
  }

  if (!isRequired) {
    schema = schema.optional();
  }

  return schema;
}

function jsonSchemaParametersToZodShape(parameters) {
  const properties = (parameters && parameters.properties) || {};
  const required = new Set((parameters && parameters.required) || []);
  const shape = {};

  for (const [name, propertySchema] of Object.entries(properties)) {
    shape[name] = jsonSchemaPropertyToZod(propertySchema, required.has(name));
  }

  return shape;
}

async function createCommerceMcpServer() {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const server = new McpServer({
    name: 'live-shop-commerce',
    version: '1.0.0',
  });

  for (const definition of AI_TOOL_DEFINITIONS) {
    const tool = definition.function;
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: jsonSchemaParametersToZodShape(tool.parameters),
      },
      async (args) => {
        try {
          const result = runCommerceTool(tool.name, args);
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
          };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: 'text', text: err.message || 'Tool execution failed' }],
          };
        }
      },
    );
  }

  return server;
}

module.exports = {
  createCommerceMcpServer,
};
