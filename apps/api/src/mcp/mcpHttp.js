'use strict';

const { randomUUID } = require('crypto');
const { createCommerceMcpServer } = require('./createCommerceMcpServer');
const { runWithMcpHeaders } = require('./mcpRequestContext');

const transports = new Map();

// Mount streamable HTTP MCP transport on the Express app.
async function mountMcpRoutes(app) {
  const { StreamableHTTPServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/streamableHttp.js'
  );
  const { isInitializeRequest } = await import('@modelcontextprotocol/sdk/types.js');

  async function handleMcpRequest(req, res) {
    const sessionId = req.headers['mcp-session-id'];
    let transport = sessionId ? transports.get(sessionId) : null;

    try {
      if (!transport && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (newSessionId) => {
            transports.set(newSessionId, transport);
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            transports.delete(transport.sessionId);
          }
        };

        const server = await createCommerceMcpServer();
        await server.connect(transport);
      } else if (!transport) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid MCP session ID provided',
          },
          id: null,
        });
        return;
      }

      const method = req.body && req.body.method;
      const toolName =
        method === 'tools/call' && req.body.params ? req.body.params.name : undefined;
      if (method) {
        console.log(
          `[VoiceAI] ${new Date().toISOString()} MCP ${method}${toolName ? ` tool=${toolName}` : ''}`,
        );
      }

      await runWithMcpHeaders(req.headers, async () => {
        await transport.handleRequest(req, res, req.body);
      });
    } catch (err) {
      console.warn(
        `[VoiceAI] ${new Date().toISOString()} MCP request failed: ${err.message || err}`,
      );
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'MCP request failed' });
      }
    }
  }

  app.post('/mcp', handleMcpRequest);
  app.get('/mcp', handleMcpRequest);

  return {
    async closeAll() {
      for (const transport of transports.values()) {
        try {
          await transport.close();
        } catch {
          // ignore cleanup errors
        }
      }
      transports.clear();
    },
  };
}

module.exports = {
  mountMcpRoutes,
};
