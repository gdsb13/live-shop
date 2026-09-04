'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API_SRC = path.join(ROOT, 'apps/api/src');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function request(port, method, urlPath, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
              ...extraHeaders,
            }
          : { ...extraHeaders },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: text }));
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 18) {
    fail(`Node ${process.versions.node} is too old; need Node 18+`);
    return;
  }

  console.log(`Phase 5 MCP verification (Node ${process.versions.node})\n`);

  const requiredFiles = [
    'apps/api/src/mcp/mcpConfig.js',
    'apps/api/src/mcp/commerceToolRunner.js',
    'apps/api/src/mcp/createCommerceMcpServer.js',
    'apps/api/src/mcp/mcpHttp.js',
    'apps/api/src/services/aiService.js',
    'apps/api/src/routes/ai.js',
  ];
  const removedFiles = ['apps/api/src/services/aiLlmProxy.js'];

  for (const relative of requiredFiles) {
    if (!fs.existsSync(path.join(ROOT, relative))) {
      fail(`missing file ${relative}`);
      return;
    }
  }
  pass('required MCP files exist');

  for (const relative of removedFiles) {
    if (fs.existsSync(path.join(ROOT, relative))) {
      fail(`removed file still present: ${relative}`);
      return;
    }
  }
  pass('CustomLLM proxy removed');

  require(path.join(API_SRC, 'loadEnv'));

  let aiRouter;
  try {
    aiRouter = require(path.join(API_SRC, 'routes/ai'));
  } catch (err) {
    fail(`cannot require routes/ai.js — ${err.message}`);
    return;
  }
  pass('routes/ai.js loads');

  const express = require('express');
  const { mountMcpRoutes } = require(path.join(API_SRC, 'mcp/mcpHttp'));
  const app = express();
  app.use(express.json());
  await mountMcpRoutes(app);
  app.use('/api/ai', aiRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  const port = server.address().port;

  try {
    const status = await request(port, 'GET', '/api/ai/status');
    if (status.status !== 200 || !status.body.includes('searchProducts')) {
      fail(`GET /api/ai/status failed: ${status.status} ${status.body}`);
      return;
    }
    if (!status.body.includes('"externalLlmKeyRequired":false')) {
      fail('status should report externalLlmKeyRequired=false');
      return;
    }
    pass('GET /api/ai/status');

    const start = await request(port, 'POST', '/api/ai/session/start', {
      surface: 'storefront',
      shopperUserId: 'shopper-ai-static-verify',
      shopperRtcUid: 123456789,
    });
    if (start.status !== 503) {
      fail(`session/start should require MCP endpoint (503), got ${start.status}`);
      return;
    }
    pass('POST /api/ai/session/start requires MCP endpoint when unset');

    const addCart = await request(
      port,
      'POST',
      '/api/ai/tools/addToCart',
      {
        productId: 'elec-headphones-sony',
        variantId: 'v-black',
        quantity: 1,
        context: { shopperUserId: 'shopper-ai-static-verify' },
      },
      { 'X-Shopper-Id': 'shopper-ai-static-verify' },
    );
    if (addCart.status !== 200 || !addCart.body.includes('"success":true')) {
      fail(`addToCart tool failed: ${addCart.status} ${addCart.body}`);
      return;
    }
    pass('POST /api/ai/tools/addToCart');
  } finally {
    server.close();
  }

  console.log('\nStatic verification complete — Agora managed LLM + MCP architecture.');
}

main().catch((err) => {
  fail(err.message);
});
