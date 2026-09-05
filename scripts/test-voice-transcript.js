#!/usr/bin/env node
'use strict';

const TurnStatus = { IN_PROGRESS: 0, END: 1, INTERRUPTED: 2 };

function mapSdkTranscriptSnapshot(items, shopperRtcUid) {
  const shopperUid = String(shopperRtcUid);
  const latestByKey = new Map();
  const order = [];

  for (const item of items) {
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (!text) continue;
    const uid =
      item.uid === undefined || item.uid === null || item.uid === '' || String(item.uid) === '0'
        ? shopperUid
        : String(item.uid);
    const role = uid === shopperUid ? 'user' : 'assistant';
    const turnId = typeof item.turn_id === 'number' ? item.turn_id : 0;
    const status = typeof item.status === 'number' ? item.status : TurnStatus.IN_PROGRESS;
    const key = `${role}:${turnId}`;
    if (!latestByKey.has(key)) order.push(key);
    latestByKey.set(key, {
      role,
      turnId,
      text,
      status,
      final: status === TurnStatus.END || status === TurnStatus.INTERRUPTED,
    });
  }

  return order.map((key) => latestByKey.get(key));
}

function buildDisplayTranscript(snapshot, { agentSpeaking, fillerLine = null }) {
  const lines = [];
  for (const item of snapshot) {
    if (item.role === 'assistant' && !item.final && !agentSpeaking) continue;
    lines.push({ role: item.role, text: item.text, final: item.final, turnId: item.turnId });
  }
  if (fillerLine && !lines.some((line) => line.filler && line.text === fillerLine.text)) {
    lines.push(fillerLine);
  }
  return lines;
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const shopperRtcUid = 424242;

const partialUser = mapSdkTranscriptSnapshot(
  [
    { uid: String(shopperRtcUid), text: 'Do you have any', turn_id: 1, status: TurnStatus.IN_PROGRESS },
    {
      uid: String(shopperRtcUid),
      text: 'Do you have any smart TV available?',
      turn_id: 1,
      status: TurnStatus.END,
    },
  ],
  shopperRtcUid,
);
if (partialUser.length !== 1) fail('partial user STT should collapse to one turn');
if (partialUser[0].text !== 'Do you have any smart TV available?') fail('user turn keeps latest text');
if (!partialUser[0].final) fail('user turn should finalize on END status');

const assistantStream = mapSdkTranscriptSnapshot(
  [
    { uid: '9001', text: 'Yes,', turn_id: 2, status: TurnStatus.IN_PROGRESS },
    {
      uid: '9001',
      text: 'Yes, I found the Samsung Crystal TV.',
      turn_id: 2,
      status: TurnStatus.END,
    },
  ],
  shopperRtcUid,
);
if (assistantStream.length !== 1) fail('streamed assistant response should be one turn');
if (!assistantStream[0].text.includes('Samsung')) fail('assistant turn keeps final text');

const duplicateFinal = mapSdkTranscriptSnapshot(
  [
    { uid: '9001', text: 'Hi, I am Priya', turn_id: 0, status: TurnStatus.END },
    { uid: '9001', text: 'Hi, I am Priya', turn_id: 0, status: TurnStatus.END },
  ],
  shopperRtcUid,
);
if (duplicateFinal.length !== 1) fail('identical final events must not duplicate greeting turn');

const hiddenInterim = buildDisplayTranscript(
  [{ role: 'assistant', turnId: 0, text: 'Hi, I am Priya', final: false, status: TurnStatus.IN_PROGRESS }],
  { agentSpeaking: false },
);
if (hiddenInterim.length !== 0) fail('interim assistant hidden until agent speaks');

const visibleInterim = buildDisplayTranscript(
  [{ role: 'assistant', turnId: 0, text: 'Hi, I am Priya', final: false, status: TurnStatus.IN_PROGRESS }],
  { agentSpeaking: true },
);
if (visibleInterim.length !== 1) fail('assistant interim visible while speaking');

const fillerOnce = buildDisplayTranscript([], {
  agentSpeaking: false,
  fillerLine: { role: 'assistant', text: 'Let me check that for you.', final: true, filler: true },
});
if (fillerOnce.length !== 1 || !fillerOnce[0].filler) fail('filler is one intentional turn');

console.log('PASS: voice transcript turn semantics');
