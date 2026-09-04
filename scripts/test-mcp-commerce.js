'use strict';

const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const fs = require('fs');

function reexecWithNvmNodeIfNeeded() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) {
    return;
  }

  const root = path.join(__dirname, '..');
  const nvmrcPath = path.join(root, '.nvmrc');
  if (!fs.existsSync(nvmrcPath)) {
    console.error(`FAIL: Node ${process.versions.node} is too old; need Node 20+ (see .nvmrc)`);
    process.exit(1);
  }

  const wanted = fs.readFileSync(nvmrcPath, 'utf8').trim();
  const home = process.env.HOME || '';
  const nvmSh = path.join(home, '.nvm', 'nvm.sh');
  if (!fs.existsSync(nvmSh)) {
    console.error(
      `FAIL: Node ${process.versions.node} is too old; install Node ${wanted} via nvm and retry`,
    );
    process.exit(1);
  }

  const bashScript = `. "${nvmSh}" && nvm use "${wanted}" >/dev/null && exec node "${__filename}"`;
  const result = spawnSync('bash', ['-lc', bashScript], {
    stdio: 'inherit',
    cwd: root,
    env: process.env,
  });
  process.exit(result.status === null ? 1 : result.status);
}

const ROOT = path.join(__dirname, '..');
reexecWithNvmNodeIfNeeded();
const API_SRC = path.join(ROOT, 'apps/api/src');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function request(port, method, urlPath, body, headers = {}) {
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
              Accept: 'application/json, text/event-stream',
              'Content-Length': Buffer.byteLength(payload),
              ...headers,
            }
          : headers,
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: text,
          }),
        );
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function mcpInitialize(port) {
  const initBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'live-shop-test', version: '1.0.0' },
    },
  };

  const init = await request(port, 'POST', '/mcp', initBody);
  if (init.status !== 200) {
    throw new Error(`MCP initialize failed (${init.status}): ${init.body}`);
  }

  const sessionId = init.headers['mcp-session-id'];
  if (!sessionId) {
    throw new Error('MCP initialize did not return mcp-session-id header');
  }

  await request(
    port,
    'POST',
    '/mcp',
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { 'mcp-session-id': sessionId },
  );

  return sessionId;
}

function parseToolText(response) {
  const text = response.result && response.result.content && response.result.content[0]
    ? response.result.content[0].text
    : '';
  return text ? JSON.parse(text) : null;
}

function toolTextIncludes(response, needle) {
  const text = response.result && response.result.content && response.result.content[0]
    ? response.result.content[0].text
    : '';
  return text.includes(needle);
}

async function mcpCall(port, sessionId, method, params, id, extraHeaders = {}) {
  const response = await request(
    port,
    'POST',
    '/mcp',
    { jsonrpc: '2.0', id, method, params },
    { 'mcp-session-id': sessionId, ...extraHeaders },
  );
  if (response.status !== 200) {
    throw new Error(`MCP ${method} failed (${response.status}): ${response.body}`);
  }
  return JSON.parse(response.body);
}

async function main() {
  require(path.join(API_SRC, 'loadEnv'));

  const express = require('express');
  const { mountMcpRoutes } = require(path.join(API_SRC, 'mcp/mcpHttp'));
  const aiSessionStore = require(path.join(API_SRC, 'services/aiSessionStore'));

  const app = express();
  app.use(express.json());
  await mountMcpRoutes(app);

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  const port = server.address().port;

  try {
    aiSessionStore.createSession({
      id: 'mcp-test-session',
      channel: 'ai-shopper-mcp-test',
      shopperUserId: 'shopper-mcp-test',
      surface: 'storefront',
      state: 'running',
      lastProductIds: [],
      cartUpdated: false,
      transcripts: [],
    });

    const sessionId = await mcpInitialize(port);
    pass('MCP initialize');

    const tools = await mcpCall(port, sessionId, 'tools/list', {}, 2);
    const toolNames = (tools.result && tools.result.tools
      ? tools.result.tools.map((tool) => tool.name)
      : []
    ).sort();
    const expected = [
      'addToCart',
      'checkServiceability',
      'compareProducts',
      'getCart',
      'getCurrentPrice',
      'getPaymentOptions',
      'getProduct',
      'removeFromCart',
      'searchProducts',
    ];
    if (JSON.stringify(toolNames) !== JSON.stringify(expected)) {
      fail(`MCP tools/list unexpected tools: ${JSON.stringify(toolNames)}`);
      return;
    }
    pass('MCP tools/list exposes all commerce tools');

    const search = await mcpCall(
      port,
      sessionId,
      'tools/call',
      {
        name: 'searchProducts',
        arguments: { query: 'noise cancelling headphones' },
      },
      3,
    );
    if (!toolTextIncludes(search, 'elec-headphones-sony')) {
      fail(`searchProducts via MCP failed: ${JSON.stringify(search)}`);
      return;
    }
    pass('MCP searchProducts');

    const mobileSearch = await mcpCall(
      port,
      sessionId,
      'tools/call',
      { name: 'searchProducts', arguments: { query: 'mobile' } },
      31,
    );
    if (!toolTextIncludes(mobileSearch, 'elec-phone-oneplus')) {
      fail(`searchProducts mobile synonym failed: ${JSON.stringify(mobileSearch)}`);
      return;
    }
    pass('MCP searchProducts finds mobile phones');

    const voiceHeaders = { 'X-Voice-Channel': 'ai-shopper-mcp-test' };
    const headphonesFlowSearch = await mcpCall(
      port,
      sessionId,
      'tools/call',
      { name: 'searchProducts', arguments: { query: 'headphones' } },
      32,
      voiceHeaders,
    );
    if (!toolTextIncludes(headphonesFlowSearch, 'elec-headphones-sony')) {
      fail(`headphones conversation search failed: ${JSON.stringify(headphonesFlowSearch)}`);
      return;
    }
    const headphonesSvc = await mcpCall(
      port,
      sessionId,
      'tools/call',
      { name: 'checkServiceability', arguments: { pin: '201014' } },
      33,
      voiceHeaders,
    );
    if (!toolTextIncludes(headphonesSvc, 'serviceable') && !toolTextIncludes(headphonesSvc, 'deliver')) {
      fail(`headphones conversation serviceability failed: ${JSON.stringify(headphonesSvc)}`);
      return;
    }
    const headphonesAdd = await mcpCall(
      port,
      sessionId,
      'tools/call',
      { name: 'addToCart', arguments: { quantity: 1 } },
      34,
      voiceHeaders,
    );
    if (!parseToolText(headphonesAdd).success) {
      fail(`headphones conversation addToCart failed: ${JSON.stringify(headphonesAdd)}`);
      return;
    }
    pass('MCP conversation flow search → serviceability → addToCart');

    const product = await mcpCall(
      port,
      sessionId,
      'tools/call',
      { name: 'getProduct', arguments: { productId: 'elec-headphones-sony' } },
      4,
    );
    if (parseToolText(product).brand !== 'Sony') {
      fail(`getProduct via MCP failed: ${JSON.stringify(product)}`);
      return;
    }
    pass('MCP getProduct');

    const ipad = await mcpCall(
      port,
      sessionId,
      'tools/call',
      { name: 'getProduct', arguments: { productId: 'elec-tablet-ipad' } },
      41,
      { 'X-Voice-Channel': 'ai-shopper-mcp-test' },
    );
    if (parseToolText(ipad).variantCount !== 2) {
      fail(`getProduct iPad variantCount failed: ${JSON.stringify(ipad)}`);
      return;
    }
    pass('MCP getProduct includes variantCount');

    const price = await mcpCall(
      port,
      sessionId,
      'tools/call',
      {
        name: 'getCurrentPrice',
        arguments: { productId: 'elec-headphones-sony', variantId: 'v-black' },
      },
      5,
    );
    if (parseToolText(price).price !== 26990) {
      fail(`getCurrentPrice via MCP failed: ${JSON.stringify(price)}`);
      return;
    }
    pass('MCP getCurrentPrice');

    const priceByName = await mcpCall(
      port,
      sessionId,
      'tools/call',
      {
        name: 'getCurrentPrice',
        arguments: { productId: 'elec-headphones-sony', variantId: 'Black' },
      },
      51,
    );
    if (parseToolText(priceByName).variantId !== 'v-black') {
      fail(`getCurrentPrice variant name resolution failed: ${JSON.stringify(priceByName)}`);
      return;
    }
    pass('MCP getCurrentPrice resolves variant display names');

    const compare = await mcpCall(
      port,
      sessionId,
      'tools/call',
      {
        name: 'compareProducts',
        arguments: { productIds: ['elec-headphones-sony', 'elec-tv-samsung-55'] },
      },
      6,
    );
    if (!toolTextIncludes(compare, 'elec-headphones-sony')) {
      fail(`compareProducts via MCP failed: ${JSON.stringify(compare)}`);
      return;
    }
    pass('MCP compareProducts');

    const svc = await mcpCall(
      port,
      sessionId,
      'tools/call',
      { name: 'checkServiceability', arguments: { pin: '201014' } },
      7,
    );
    if (!toolTextIncludes(svc, 'deliver') && !toolTextIncludes(svc, 'serviceable')) {
      fail(`checkServiceability via MCP failed: ${JSON.stringify(svc)}`);
      return;
    }
    pass('MCP checkServiceability');

    const pay = await mcpCall(
      port,
      sessionId,
      'tools/call',
      { name: 'getPaymentOptions', arguments: {} },
      8,
    );
    if (!toolTextIncludes(pay, 'options')) {
      fail(`getPaymentOptions via MCP failed: ${JSON.stringify(pay)}`);
      return;
    }
    pass('MCP getPaymentOptions');

    const add = await mcpCall(
      port,
      sessionId,
      'tools/call',
      {
        name: 'addToCart',
        arguments: {
          productId: 'elec-headphones-sony',
          variantId: 'v-black',
          quantity: 1,
        },
      },
      9,
    );
    if (!parseToolText(add).success) {
      fail(`addToCart via MCP failed: ${JSON.stringify(add)}`);
      return;
    }
    pass('MCP addToCart mutates cart');

    const addDefault = await mcpCall(
      port,
      sessionId,
      'tools/call',
      {
        name: 'addToCart',
        arguments: {
          productId: 'elec-tv-samsung-55',
          quantity: 1,
        },
      },
      91,
      { 'X-Voice-Channel': 'ai-shopper-mcp-test' },
    );
    if (!parseToolText(addDefault).success) {
      fail(`addToCart default variant failed: ${JSON.stringify(addDefault)}`);
      return;
    }
    pass('MCP addToCart uses default variant');

    const addFromContext = await mcpCall(
      port,
      sessionId,
      'tools/call',
      {
        name: 'addToCart',
        arguments: { quantity: 1 },
      },
      92,
      { 'X-Voice-Channel': 'ai-shopper-mcp-test' },
    );
    if (!parseToolText(addFromContext).success) {
      fail(`addToCart session context failed: ${JSON.stringify(addFromContext)}`);
      return;
    }
    pass('MCP addToCart resolves product from voice session context');

    const cartView = await mcpCall(
      port,
      sessionId,
      'tools/call',
      { name: 'getCart', arguments: {} },
      93,
    );
    if (!parseToolText(cartView).itemCount) {
      fail(`getCart via MCP failed: ${JSON.stringify(cartView)}`);
      return;
    }
    pass('MCP getCart returns cart state');

    const remove = await mcpCall(
      port,
      sessionId,
      'tools/call',
      { name: 'removeFromCart', arguments: { productId: 'elec-headphones-sony' } },
      10,
    );
    if (!parseToolText(remove).success) {
      fail(`removeFromCart via MCP failed: ${JSON.stringify(remove)}`);
      return;
    }
    pass('MCP removeFromCart');

    const badPin = await request(
      port,
      'POST',
      '/mcp',
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'checkServiceability', arguments: { pin: '12' } },
      },
      { 'mcp-session-id': sessionId },
    );
    const badPinJson = JSON.parse(badPin.body);
    const rejected =
      badPin.status !== 200 ||
      Boolean(badPinJson.error) ||
      Boolean(badPinJson.result && badPinJson.result.isError);
    if (!rejected) {
      fail('invalid PIN should be rejected by MCP tool validation');
      return;
    }
    pass('MCP rejects invalid tool arguments');

    console.log('\nMCP commerce tool verification complete.');
  } finally {
    server.close();
  }
}

main().catch((err) => {
  fail(err.message);
});
