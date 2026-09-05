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

function buildDisplayTranscript(snapshot, { agentSpeaking, agentThinking = false }) {
  const lines = [];
  const showInterimAssistant = agentSpeaking || agentThinking;
  for (const item of snapshot) {
    if (item.role === 'assistant' && !item.final && !showInterimAssistant) continue;
    lines.push({ role: item.role, text: item.text, final: item.final, turnId: item.turnId });
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
  { agentSpeaking: false, agentThinking: false },
);
if (hiddenInterim.length !== 0) fail('interim assistant hidden while idle');

const visibleWhileThinking = buildDisplayTranscript(
  [{ role: 'assistant', turnId: 0, text: 'Hi, I am Priya', final: false, status: TurnStatus.IN_PROGRESS }],
  { agentSpeaking: false, agentThinking: true },
);
if (visibleWhileThinking.length !== 1) fail('assistant interim visible while thinking');

const visibleInterim = buildDisplayTranscript(
  [{ role: 'assistant', turnId: 0, text: 'Hi, I am Priya', final: false, status: TurnStatus.IN_PROGRESS }],
  { agentSpeaking: true, agentThinking: false },
);
if (visibleInterim.length !== 1) fail('assistant interim visible while speaking');

function isUserGoodbyeContinuation(text) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return (
    /^thanks?(\s+you)?(\s+very\s+much)?\.?$/.test(normalized) ||
    /^thank you(\s+very\s+much)?\.?$/.test(normalized)
  );
}

function shouldCancelFarewellPending(text) {
  if (/^(are you there|you there|hello|hello\??|hi\??)\b/.test(text.trim().toLowerCase())) return false;
  if (isUserGoodbyeIntent(text)) return false;
  if (isUserGoodbyeContinuation(text)) return false;
  return true;
}

function findFinalAssistantTurnAfterUserTurn(snapshot, userTurn) {
  const anchorIndex = snapshot.findIndex(
    (item) => item.role === 'user' && item.turnId === userTurn.turnId,
  );
  if (anchorIndex < 0) return undefined;
  return snapshot.slice(anchorIndex + 1).find((item) => item.role === 'assistant' && item.final);
}

function isUserGoodbyeIntent(text, options = {}) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (
    /\b(bye|goodbye|good\s+bye)\b/.test(normalized) ||
    /\b(that'?s all|that is all|that'?s it|that is it)\b/.test(normalized) ||
    /\b(end (the )?(conversation|session)|stop talking)\b/.test(normalized) ||
    /\b(no thanks|no thank you|nothing else|i'?m done|im done)\b/.test(normalized) ||
    /\bno\b[\s,.!]*\b(thanks?|thank you)\b/.test(normalized) ||
    /^(stop|thanks\.?\s*|thank you\.?\s*)$/.test(normalized) ||
    isUserGoodbyeContinuation(text)
  ) {
    return true;
  }
  if (options.orderCompleted && /^no[\s,.!]*\.?\s*$/.test(normalized)) return true;
  return false;
}

if (!isUserGoodbyeIntent('No. That is it.')) fail('that is it should close the session');
if (!isUserGoodbyeIntent('No. Thank you.')) fail('no thank you should close the session');
if (!isUserGoodbyeIntent('No.', { orderCompleted: true })) fail('no after order should close');
if (isUserGoodbyeIntent('No.', { orderCompleted: false })) fail('plain no before order should not close');
if (!isUserGoodbyeIntent("Yeah. That's all. Thank you.")) fail("that's all thank you should close");
if (!isUserGoodbyeIntent('You can end the session.')) fail('end the session should close');
if (!isUserGoodbyeIntent("That's all. Thanks.")) fail("that's all thanks should close");
if (!isUserGoodbyeIntent('Goodbye.')) fail('goodbye should close');
if (isUserGoodbyeIntent('Are you there?')) fail('presence check is not goodbye');
if (shouldCancelFarewellPending('Thank you very much.')) fail('extra thanks should not cancel farewell');
if (shouldCancelFarewellPending('Are you there?')) fail('presence check should not cancel farewell');
if (!shouldCancelFarewellPending('Show me earbuds')) fail('new shopping request should cancel farewell');

const farewellSnapshot = [
  { role: 'user', turnId: 3, text: "No. That's it. Thank you.", final: true },
  { role: 'assistant', turnId: 4, text: 'Happy shopping! You can keep watching the live session.', final: true },
];
const anchor = farewellSnapshot[0];
if (!findFinalAssistantTurnAfterUserTurn(farewellSnapshot, anchor)) {
  fail('assistant farewell should be found after goodbye user turn');
}

console.log('PASS: voice transcript turn semantics');
