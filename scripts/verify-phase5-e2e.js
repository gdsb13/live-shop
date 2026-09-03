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

function request(port, method, urlPath, body) {
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
            }
          : {},
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
    fail(`Node ${process.versions.node} is too old; need Node 18+ (project uses 20.19+)`);
    return;
  }

  console.log(`Phase 5 static + in-process HTTP verification (Node ${process.versions.node})\n`);

  const requiredFiles = [
    'apps/api/src/routes/ai.js',
    'apps/api/src/services/aiService.js',
    'apps/api/src/services/aiLlmProxy.js',
    'apps/api/src/services/aiToolService.js',
    'apps/api/src/services/aiToolDefinitions.js',
    'apps/api/src/services/aiToolValidation.js',
    'apps/api/src/services/aiSessionStore.js',
    'apps/web/src/hooks/useVoiceAssistant.ts',
    'apps/web/src/components/VoiceAssistantPanel.tsx',
  ];

  for (const relative of requiredFiles) {
    const absolute = path.join(ROOT, relative);
    if (!fs.existsSync(absolute)) {
      fail(`missing file ${relative}`);
      return;
    }
  }
  pass('all required Phase 5 files exist');

  require(path.join(API_SRC, 'loadEnv'));

  let aiRouter;
  try {
    aiRouter = require(path.join(API_SRC, 'routes/ai'));
  } catch (err) {
    fail(`cannot require routes/ai.js — ${err.message}`);
    return;
  }
  pass('routes/ai.js loads (all service dependencies resolve)');

  const express = require('express');
  const app = express();
  app.use(express.json());
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
    if (status.status !== 200) {
      fail(`GET /api/ai/status returned ${status.status}: ${status.body}`);
      return;
    }
    if (!status.body.includes('searchProducts')) {
      fail(`GET /api/ai/status unexpected body: ${status.body}`);
      return;
    }
    pass('GET /api/ai/status');

    const start = await request(port, 'POST', '/api/ai/session/start', {
      surface: 'storefront',
      shopperUserId: 'shopper-ai-static-verify',
    });
    if (start.status !== 200) {
      fail(`POST /api/ai/session/start returned ${start.status}: ${start.body}`);
      return;
    }
    const started = JSON.parse(start.body);
    if (!started.sessionId || started.mode !== 'local') {
      fail(`POST /api/ai/session/start unexpected body: ${start.body}`);
      return;
    }
    pass('POST /api/ai/session/start (local mode)');

    const turn = await request(port, 'POST', '/api/ai/local/turn', {
      sessionId: started.sessionId,
      text: 'Add the Sony headphones to my cart',
    });
    if (turn.status !== 200) {
      fail(`POST /api/ai/local/turn returned ${turn.status}: ${turn.body}`);
      return;
    }
    if (!turn.body.includes('"cartUpdated":true')) {
      fail(`POST /api/ai/local/turn did not update cart: ${turn.body}`);
      return;
    }
    pass('POST /api/ai/local/turn add-to-cart');

    const searchTv = await request(port, 'POST', '/api/ai/local/turn', {
      sessionId: started.sessionId,
      text: 'Smart TV',
    });
    if (searchTv.status !== 200 || !searchTv.body.includes('Samsung')) {
      fail(`Smart TV search failed: ${searchTv.status} ${searchTv.body}`);
      return;
    }
    pass('POST /api/ai/local/turn smart TV search');

    const searchPhone = await request(port, 'POST', '/api/ai/local/turn', {
      sessionId: started.sessionId,
      text: 'OnePlus Nord 4 5G',
    });
    if (searchPhone.status !== 200 || !searchPhone.body.includes('OnePlus')) {
      fail(`OnePlus search failed: ${searchPhone.status} ${searchPhone.body}`);
      return;
    }
    pass('POST /api/ai/local/turn OnePlus search');

    const helpTv = await request(port, 'POST', '/api/ai/local/turn', {
      sessionId: started.sessionId,
      text: 'Can you help me select a smart TV?',
    });
    if (helpTv.status !== 200 || !helpTv.body.includes('Samsung')) {
      fail(`help select smart TV failed: ${helpTv.status} ${helpTv.body}`);
      return;
    }
    pass('POST /api/ai/local/turn help select smart TV');

    const alternatives = await request(port, 'POST', '/api/ai/local/turn', {
      sessionId: started.sessionId,
      text: 'Is there any other option?',
    });
    if (alternatives.status !== 200 || !alternatives.body.includes('43')) {
      fail(`alternatives follow-up failed: ${alternatives.status} ${alternatives.body}`);
      return;
    }
    pass('POST /api/ai/local/turn alternatives follow-up');

    const remove = await request(port, 'POST', '/api/ai/local/turn', {
      sessionId: started.sessionId,
      text: 'Delete it from my cart',
    });
    if (remove.status !== 200 || !remove.body.includes('Removed')) {
      fail(`remove from cart failed: ${remove.status} ${remove.body}`);
      return;
    }
    pass('POST /api/ai/local/turn remove from cart');

    const done = await request(port, 'POST', '/api/ai/local/turn', {
      sessionId: started.sessionId,
      text: 'I am done',
    });
    if (done.status !== 200 || !done.body.includes('"endSession":true')) {
      fail(`end session failed: ${done.status} ${done.body}`);
      return;
    }
    pass('POST /api/ai/local/turn end session');

    const stop = await request(port, 'POST', '/api/ai/session/stop', {
      sessionId: started.sessionId,
      shopperUserId: 'shopper-ai-static-verify',
    });
    if (stop.status !== 200) {
      fail(`POST /api/ai/session/stop returned ${stop.status}: ${stop.body}`);
      return;
    }
    pass('POST /api/ai/session/stop');

    const addCart = await request(port, 'POST', '/api/ai/tools/addToCart', {
      productId: 'elec-tv-samsung-55',
      variantId: 'v-55',
      quantity: 1,
    });
    if (addCart.status !== 200 || !addCart.body.includes('"success":true')) {
      fail(`addToCart tool failed: ${addCart.status} ${addCart.body}`);
      return;
    }
    pass('POST /api/ai/tools/addToCart');

    console.log('\nStatic verification complete — Phase 5 API routes work in-process.');
    console.log(
      'If the browser still shows 404, the RUNNING server on :3001 is stale. Run: ./scripts/stop.sh && ./scripts/start.sh',
    );
  } finally {
    server.close();
  }
}

main().catch((err) => {
  fail(err.message);
});
