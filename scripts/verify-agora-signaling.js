#!/usr/bin/env node
'use strict';

const { RtmTokenBuilder } = require('agora-token');
const { AccessToken2, kRtmServiceType } = require('agora-token/src/AccessToken2');

require('../apps/api/src/loadEnv.js');

const appId = String(process.env.AGORA_APP_ID || '').trim();
const cert = String(process.env.AGORA_APP_CERTIFICATE || '').trim();
const area = String(process.env.AGORA_SIGNALING_AREA || 'ASIA').trim();

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!/^[0-9a-fA-F]{32}$/.test(appId)) {
  fail('AGORA_APP_ID must be 32 hex characters');
}
if (!/^[0-9a-fA-F]{32}$/.test(cert)) {
  fail('AGORA_APP_CERTIFICATE must be 32 hex characters');
}

const userId = 'verify-signaling-user';
const token = RtmTokenBuilder.buildToken(appId, cert, userId, 3600);
const parsed = new AccessToken2('', '', 0, 0);
if (!parsed.from_string(token)) {
  fail('generated token could not be parsed');
}

const services = parsed.getServices(kRtmServiceType);
if (!services.length) {
  fail('token is missing RTM login service');
}

console.log('Agora Signaling token diagnostics');
console.log(`  appId prefix/suffix: ${appId.slice(0, 4)}…${appId.slice(-4)}`);
console.log(`  appId length: ${appId.length}`);
console.log(`  token appId matches: ${parsed.appId === appId}`);
console.log(`  token signature valid: ${parsed.verifySignature(cert)}`);
console.log(`  rtm userId in token: ${services[0].__user_id}`);
console.log(`  signaling area env: ${area}`);
console.log('');
console.log('Compare prefix/suffix with Agora Console → live-shop-rtc → App ID.');
console.log('If they differ, update AGORA_APP_ID / AGORA_APP_CERTIFICATE in .env.');
