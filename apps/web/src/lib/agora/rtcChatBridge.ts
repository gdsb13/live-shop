import type { IAgoraRTCClient, UID } from 'agora-rtc-sdk-ng';
import type { LiveChatMessage } from './types';

type ChatListener = (message: LiveChatMessage) => void;
type ReadyListener = () => void;
type StreamMessageHandler = (uid: UID, payload: Uint8Array) => void;

type IAgoraRtcStreamClient = IAgoraRTCClient & {
  sendStreamMessage(payload: Uint8Array): Promise<void>;
  on(event: 'stream-message', listener: StreamMessageHandler): void;
  off(event: 'stream-message', listener: StreamMessageHandler): void;
};

type SessionEntry = {
  client: IAgoraRtcStreamClient;
  onMessage: StreamMessageHandler;
};

const sessions = new Map<string, SessionEntry>();
const listenersBySession = new Map<string, Set<ChatListener>>();
const pendingReady = new Map<string, Set<ReadyListener>>();

function getOrCreateListeners(sessionId: string) {
  const existing = listenersBySession.get(sessionId);
  if (existing) return existing;
  const listeners = new Set<ChatListener>();
  listenersBySession.set(sessionId, listeners);
  return listeners;
}

function notifyListeners(sessionId: string, message: LiveChatMessage) {
  getOrCreateListeners(sessionId).forEach((listener) => listener(message));
}

function parsePayload(payload: Uint8Array): LiveChatMessage | null {
  try {
    const text = new TextDecoder().decode(payload);
    const parsed = JSON.parse(text) as LiveChatMessage;
    if (!parsed?.id || !parsed?.sender || !parsed?.text || !parsed?.ts) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function notifyReady(sessionId: string) {
  const listeners = pendingReady.get(sessionId);
  if (!listeners) return;
  listeners.forEach((listener) => listener());
  pendingReady.delete(sessionId);
}

export function isRtcChatReady(sessionId: string) {
  return sessions.has(sessionId);
}

export function onRtcChatReady(sessionId: string, listener: ReadyListener) {
  if (isRtcChatReady(sessionId)) {
    listener();
    return () => undefined;
  }

  const listeners = pendingReady.get(sessionId) ?? new Set<ReadyListener>();
  listeners.add(listener);
  pendingReady.set(sessionId, listeners);

  return () => {
    pendingReady.get(sessionId)?.delete(listener);
  };
}

export function subscribeRtcChat(sessionId: string, listener: ChatListener) {
  const listeners = getOrCreateListeners(sessionId);
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function attachRtcChat(sessionId: string, client: IAgoraRTCClient) {
  const streamClient = client as IAgoraRtcStreamClient;
  const existing = sessions.get(sessionId);
  if (existing?.client === streamClient) {
    notifyReady(sessionId);
    return;
  }

  if (existing) {
    detachRtcChat(sessionId, existing.client);
  }

  const entry: SessionEntry = {
    client: streamClient,
    onMessage: (_uid, payload) => {
      const message = parsePayload(payload);
      if (!message) return;
      notifyListeners(sessionId, message);
    },
  };

  streamClient.on('stream-message', entry.onMessage);
  sessions.set(sessionId, entry);
  notifyReady(sessionId);
}

export function detachRtcChat(sessionId: string, client: IAgoraRTCClient) {
  const entry = sessions.get(sessionId);
  if (!entry || entry.client !== client) return;

  entry.client.off('stream-message', entry.onMessage);
  sessions.delete(sessionId);
}

export async function sendRtcChat(sessionId: string, sender: string, text: string) {
  const entry = sessions.get(sessionId);
  if (!entry) {
    throw new Error('Chat is not connected to the live channel yet');
  }

  const message: LiveChatMessage = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sender: sender.slice(0, 64),
    text: text.slice(0, 500),
    ts: new Date().toISOString(),
  };

  const payload = new TextEncoder().encode(JSON.stringify(message));
  await entry.client.sendStreamMessage(payload);
  notifyListeners(sessionId, message);
  return message;
}
