'use strict';

const { ALLOWED_TOOL_NAMES } = require('../services/aiToolDefinitions');

const MCP_SERVER_NAME = 'liveshop';

// Public MCP URL Agora cloud calls (e.g. https://xxxx.ngrok-free.app/mcp).
function getMcpEndpoint() {
  const explicit = String(process.env.MCP_ENDPOINT || '').trim();
  if (explicit) {
    return explicit.endsWith('/mcp') ? explicit : `${explicit.replace(/\/$/, '')}/mcp`;
  }

  const base = String(process.env.AI_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (base) {
    return `${base}/mcp`;
  }

  return '';
}

function requireMcpEndpoint() {
  const endpoint = getMcpEndpoint();
  if (!endpoint) {
    const err = new Error(
      'MCP_ENDPOINT or AI_PUBLIC_BASE_URL is not configured. Agora cloud must reach /mcp over HTTPS (for example via ngrok).',
    );
    err.status = 503;
    err.code = 'MCP_ENDPOINT_REQUIRED';
    throw err;
  }
  return endpoint;
}

// Agora managed LLM MCP server configuration for one private voice session.
function buildMcpServers(endpoint, channel) {
  return [
    {
      name: MCP_SERVER_NAME,
      endpoint,
      transport: 'streamable_http',
      allowed_tools: [...ALLOWED_TOOL_NAMES],
      headers: {
        'X-Voice-Channel': channel,
      },
    },
  ];
}

module.exports = {
  MCP_SERVER_NAME,
  getMcpEndpoint,
  requireMcpEndpoint,
  buildMcpServers,
};
