'use strict';

const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const fs = require('fs');

function reexecWithNvmNodeIfNeeded() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) return;

  const root = path.join(__dirname, '..');
  const nvmSh = path.join(process.env.HOME || '', '.nvm', 'nvm.sh');
  if (!fs.existsSync(nvmSh)) {
    console.error(`FAIL: Node ${process.versions.node} is too old; need Node 20+`);
    process.exit(1);
  }
  const wanted = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim();
  const result = spawnSync(
    'bash',
    ['-lc', `. "${nvmSh}" && nvm use "${wanted}" >/dev/null && exec node "${__filename}"`],
    { stdio: 'inherit', cwd: root, env: process.env },
  );
  process.exit(result.status === null ? 1 : result.status);
}

reexecWithNvmNodeIfNeeded();

const API_PORT = Number(process.env.API_PORT || 3001);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function request(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: API_PORT,
        path: urlPath,
        method,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              Accept: 'application/json, text/event-stream',
              'Content-Length': Buffer.byteLength(payload),
              ...headers,
            }
          : { Accept: 'application/json, text/event-stream', ...headers },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: text }),
        );
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function json(method, urlPath, body, headers) {
  const res = await request(method, urlPath, body, headers);
  let parsed = null;
  try {
    parsed = res.body ? JSON.parse(res.body) : null;
  } catch {
    parsed = res.body;
  }
  return { status: res.status, headers: res.headers, json: parsed, body: res.body };
}

function parseToolText(response) {
  const text =
    response.result && response.result.content && response.result.content[0]
      ? response.result.content[0].text
      : '';
  return text ? JSON.parse(text) : null;
}

async function mcpInitialize() {
  const init = await request('POST', '/mcp', {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'live-shop-e2e', version: '1.0.0' },
    },
  });
  if (init.status !== 200) {
    throw new Error(`MCP initialize failed (${init.status}): ${init.body}`);
  }
  const sessionId = init.headers['mcp-session-id'];
  if (!sessionId) throw new Error('MCP initialize missing mcp-session-id');
  await request(
    'POST',
    '/mcp',
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { 'mcp-session-id': sessionId },
  );
  return sessionId;
}

async function mcpCall(mcpSessionId, id, method, params, extraHeaders = {}) {
  const res = await json(
    'POST',
    '/mcp',
    { jsonrpc: '2.0', id, method, params },
    { 'mcp-session-id': mcpSessionId, ...extraHeaders },
  );
  if (res.status !== 200) {
    throw new Error(`MCP ${method} failed (${res.status}): ${res.body}`);
  }
  return res.json;
}

async function runPass(passNumber) {
  console.log(`\n===== Voice AI E2E pass ${passNumber} =====`);

  const health = await json('GET', '/health');
  if (health.status !== 200) {
    fail(`pass ${passNumber}: API health ${health.status}`);
    return false;
  }
  pass(`pass ${passNumber}: API health`);

  const status = await json('GET', '/api/ai/status');
  const tools = (status.json && status.json.allowedTools) || [];
  const required = [
    'searchProducts',
    'getProduct',
    'compareProducts',
    'checkServiceability',
    'getPaymentOptions',
    'getCart',
    'getCurrentPrice',
    'addToCart',
    'removeFromCart',
  ];
  const missing = required.filter((name) => !tools.includes(name));
  if (missing.length) {
    fail(`pass ${passNumber}: missing tools ${missing.join(',')}`);
    return false;
  }
  pass(`pass ${passNumber}: all ${required.length} MCP tools advertised`);

  const start = await json('POST', '/api/ai/session/start', {
    surface: 'storefront',
    shopperUserId: `shopper-e2e-pass-${passNumber}`,
    shopperRtcUid: 100000 + passNumber,
  });
  if (start.status !== 200 || !start.json.sessionId || !start.json.greeting) {
    fail(`pass ${passNumber}: session start failed ${start.body}`);
    return false;
  }
  if (!/Priya/i.test(start.json.greeting)) {
    fail(`pass ${passNumber}: greeting is not the Priya welcome: ${start.json.greeting}`);
    return false;
  }
  pass(`pass ${passNumber}: session start greeting="${start.json.greeting}"`);

  const voiceChannel = start.json.channel;
  const voiceHeaders = { 'X-Voice-Channel': voiceChannel };
  const mcpSessionId = await mcpInitialize();
  pass(`pass ${passNumber}: MCP initialize`);

  const listed = await mcpCall(mcpSessionId, 2, 'tools/list', {}, voiceHeaders);
  const listedNames = ((listed.result && listed.result.tools) || []).map((t) => t.name).sort();
  if (listedNames.join(',') !== required.slice().sort().join(',')) {
    fail(`pass ${passNumber}: MCP tools/list ${JSON.stringify(listedNames)}`);
    return false;
  }
  pass(`pass ${passNumber}: MCP tools/list`);

  const search = parseToolText(
    await mcpCall(
      mcpSessionId,
      3,
      'tools/call',
      { name: 'searchProducts', arguments: { query: 'iPad' } },
      voiceHeaders,
    ),
  );
  if (!search || !search.products || !search.products.some((p) => p.id === 'elec-tablet-ipad')) {
    fail(`pass ${passNumber}: searchProducts ${JSON.stringify(search)}`);
    return false;
  }
  pass(`pass ${passNumber}: searchProducts`);

  const product = parseToolText(
    await mcpCall(
      mcpSessionId,
      4,
      'tools/call',
      { name: 'getProduct', arguments: { productId: 'elec-tablet-ipad' } },
      voiceHeaders,
    ),
  );
  if (!product || product.variantCount !== 2) {
    fail(`pass ${passNumber}: getProduct ${JSON.stringify(product)}`);
    return false;
  }
  pass(`pass ${passNumber}: getProduct variantCount`);

  const price = parseToolText(
    await mcpCall(
      mcpSessionId,
      5,
      'tools/call',
      { name: 'getCurrentPrice', arguments: { productId: 'elec-tablet-ipad' } },
      voiceHeaders,
    ),
  );
  if (!price || price.variantId !== 'v-wifi-128') {
    fail(`pass ${passNumber}: getCurrentPrice default variant ${JSON.stringify(price)}`);
    return false;
  }
  pass(`pass ${passNumber}: getCurrentPrice`);

  const compare = parseToolText(
    await mcpCall(
      mcpSessionId,
      6,
      'tools/call',
      {
        name: 'compareProducts',
        arguments: { productIds: ['elec-tablet-ipad', 'elec-headphones-sony'] },
      },
      voiceHeaders,
    ),
  );
  if (!compare || !Array.isArray(compare.products) || compare.products.length < 2) {
    fail(`pass ${passNumber}: compareProducts ${JSON.stringify(compare)}`);
    return false;
  }
  pass(`pass ${passNumber}: compareProducts`);

  const svc = parseToolText(
    await mcpCall(
      mcpSessionId,
      7,
      'tools/call',
      { name: 'checkServiceability', arguments: { pin: '201014' } },
      voiceHeaders,
    ),
  );
  if (!svc) {
    fail(`pass ${passNumber}: checkServiceability ${JSON.stringify(svc)}`);
    return false;
  }
  pass(`pass ${passNumber}: checkServiceability`);

  const pay = parseToolText(
    await mcpCall(
      mcpSessionId,
      8,
      'tools/call',
      { name: 'getPaymentOptions', arguments: {} },
      voiceHeaders,
    ),
  );
  if (!pay) {
    fail(`pass ${passNumber}: getPaymentOptions ${JSON.stringify(pay)}`);
    return false;
  }
  pass(`pass ${passNumber}: getPaymentOptions`);

  const add = parseToolText(
    await mcpCall(
      mcpSessionId,
      9,
      'tools/call',
      {
        name: 'addToCart',
        arguments: { productId: 'elec-tablet-ipad', variantId: 'v-wifi-128', quantity: 1 },
      },
      voiceHeaders,
    ),
  );
  if (!add || !add.success || !add.cart || add.cart.itemCount < 1) {
    fail(`pass ${passNumber}: addToCart ${JSON.stringify(add)}`);
    return false;
  }
  pass(`pass ${passNumber}: addToCart mutates cart itemCount=${add.cart.itemCount}`);

  const sessionPoll = await json('GET', `/api/ai/session/${start.json.sessionId}`);
  if (sessionPoll.status !== 200) {
    fail(`pass ${passNumber}: session poll ${sessionPoll.body}`);
    return false;
  }
  if (!sessionPoll.json.cartUpdated) {
    fail(`pass ${passNumber}: session poll missing cartUpdated flag`);
    return false;
  }
  if (!sessionPoll.json.cart || sessionPoll.json.cart.itemCount < 1) {
    fail(`pass ${passNumber}: session poll cart snapshot empty ${JSON.stringify(sessionPoll.json.cart)}`);
    return false;
  }
  if (!Array.isArray(sessionPoll.json.transcripts) || sessionPoll.json.transcripts.length < 1) {
    fail(
      `pass ${passNumber}: session transcripts missing ${JSON.stringify(sessionPoll.json.transcripts)}`,
    );
    return false;
  }
  pass(
    `pass ${passNumber}: session poll cartUpdated + cart snapshot + greeting transcript`,
  );

  const restCart = await json('GET', '/api/cart');
  if (restCart.status !== 200 || !restCart.json.itemCount) {
    fail(`pass ${passNumber}: GET /api/cart empty after add ${restCart.body}`);
    return false;
  }
  pass(`pass ${passNumber}: GET /api/cart itemCount=${restCart.json.itemCount}`);

  const cartView = parseToolText(
    await mcpCall(
      mcpSessionId,
      10,
      'tools/call',
      { name: 'getCart', arguments: {} },
      voiceHeaders,
    ),
  );
  if (!cartView || !cartView.itemCount) {
    fail(`pass ${passNumber}: getCart ${JSON.stringify(cartView)}`);
    return false;
  }
  pass(`pass ${passNumber}: getCart`);

  const removed = parseToolText(
    await mcpCall(
      mcpSessionId,
      11,
      'tools/call',
      { name: 'removeFromCart', arguments: { productId: 'elec-tablet-ipad' } },
      voiceHeaders,
    ),
  );
  if (!removed || !removed.success) {
    fail(`pass ${passNumber}: removeFromCart ${JSON.stringify(removed)}`);
    return false;
  }
  pass(`pass ${passNumber}: removeFromCart`);

  const afterRemove = await json('GET', '/api/cart');
  const stillHasIpad = (afterRemove.json.items || []).some(
    (item) => item.productId === 'elec-tablet-ipad',
  );
  if (stillHasIpad) {
    fail(`pass ${passNumber}: iPad still in cart after remove`);
    return false;
  }
  pass(`pass ${passNumber}: cart no longer contains iPad`);

  const stopped = await json('POST', '/api/ai/session/stop', {
    sessionId: start.json.sessionId,
    shopperUserId: `shopper-e2e-pass-${passNumber}`,
  });
  if (stopped.status !== 200) {
    fail(`pass ${passNumber}: session stop ${stopped.body}`);
    return false;
  }
  pass(`pass ${passNumber}: session stop`);
  return true;
}

async function main() {
  const first = await runPass(1);
  const second = await runPass(2);
  if (first && second && !process.exitCode) {
    console.log('\nVoice AI E2E: both passes complete.');
  } else {
    fail('Voice AI E2E did not complete both passes');
    process.exit(1);
  }
}

main().catch((err) => {
  fail(err.message || String(err));
  process.exit(1);
});
