'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function runWithMcpHeaders(headers, fn) {
  return storage.run(headers || {}, fn);
}

function getMcpRequestHeaders() {
  return storage.getStore() || {};
}

module.exports = {
  runWithMcpHeaders,
  getMcpRequestHeaders,
};
