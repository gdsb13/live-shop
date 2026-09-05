'use strict';

const z = require('zod/v4');
const { AI_TOOL_DEFINITIONS } = require('../services/aiToolDefinitions');
const { runCommerceTool } = require('./commerceToolRunner');
const { recoverableToolError } = require('../services/toolResult');

function toolInputSchema(parameters) {
  const properties = (parameters && parameters.properties) || {};
  const shape = {};

  // Advertise documented argument names, but accept any JSON value and extra keys.
  // Agora validates tools/list JSON Schema before HTTP; `additionalProperties: false`
  // or `type: string` rejects typical LLM checkout payloads and kills the voice turn
  // before our handler (so we never even log tool_call_requested).
  for (const [name, propertySchema] of Object.entries(properties)) {
    let field = z.any().optional();
    if (propertySchema && propertySchema.description) {
      field = field.describe(propertySchema.description);
    }
    shape[name] = field;
  }

  return z.looseObject(shape);
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
        inputSchema: toolInputSchema(tool.parameters),
      },
      async (args) => {
        try {
          const result = runCommerceTool(tool.name, args);
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
          };
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  recoverableToolError(
                    'TOOL_EXECUTION_FAILED',
                    err.message || 'Tool execution failed',
                  ),
                ),
              },
            ],
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
