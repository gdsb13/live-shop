'use strict';

const fs = require('fs');
const path = require('path');

// Load repo-root .env with trimmed values (handles CRLF from Windows editors).
const envPath = path.join(__dirname, '../../../.env');
if (!fs.existsSync(envPath)) return;

const content = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
for (const line of content.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const separator = trimmed.indexOf('=');
  if (separator === -1) continue;
  const key = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim();
  const alwaysReload = key.startsWith('AGORA_') || key.startsWith('AI_');
  if (!process.env[key] || alwaysReload) {
    process.env[key] = value;
  }
}
