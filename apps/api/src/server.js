'use strict';

require('./loadEnv');

const express = require('express');
const { mountMcpRoutes } = require('./mcp/mcpHttp');

const PORT = Number(process.env.API_PORT || 3001);
const HOST = process.env.API_HOST || '0.0.0.0';
const WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:3000';

async function startServer() {
  const app = express();

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', WEB_ORIGIN);
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Mcp-Session-Id, X-Voice-Channel, X-Shopper-Id',
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json());

  await mountMcpRoutes(app);

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'api',
      features: {
        voiceAi: true,
        mcp: true,
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/products', require('./routes/products'));
  app.use('/api/cart', require('./routes/cart'));
  app.use('/api/serviceability', require('./routes/serviceability'));
  app.use('/api/payment-options', require('./routes/payments'));
  app.use('/api/checkout', require('./routes/checkout'));
  app.use('/api/live-sessions', require('./routes/liveSessions'));
  app.use('/api/agora', require('./routes/agora'));
  app.use('/api/chat', require('./routes/chat'));
  app.use('/api/ai', require('./routes/ai'));

  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    res.status(status).json({
      error: err.message || 'Internal server error',
    });
  });

  app.listen(PORT, HOST, () => {
    console.log(`api listening on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start API server:', err);
  process.exit(1);
});
