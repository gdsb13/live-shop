'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isRtcChatReady,
  onRtcChatReady,
  sendRtcChat,
  subscribeRtcChat,
} from '@/lib/agora/rtcChatBridge';
import { getSessionChatName, setSessionChatName } from '@/lib/agora/identity';
import type { LiveChatMessage } from '@/lib/agora/types';

type ChatState = 'idle' | 'connecting' | 'connected' | 'ended' | 'error';

export function useLiveChat(sessionId: string, sessionStatus: string, isHost = false) {
  const connectGenRef = useRef(0);
  const [state, setState] = useState<ChatState>('idle');
  const [error, setError] = useState('');
  const [nameDraft, setNameDraft] = useState(isHost ? 'Host' : '');
  const [displayName, setDisplayName] = useState('');
  const [chatJoined, setChatJoined] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);

  const mergeMessages = useCallback((incoming: LiveChatMessage[]) => {
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      incoming.forEach((m) => map.set(m.id, m));
      return [...map.values()]
        .sort((a, b) => a.ts.localeCompare(b.ts))
        .slice(-100);
    });
  }, []);

  useEffect(() => {
    const saved = getSessionChatName(sessionId, isHost);
    if (saved) {
      setDisplayName(saved);
      setNameDraft(saved);
      setChatJoined(true);
      return;
    }
    setDisplayName('');
    setNameDraft(isHost ? 'Host' : '');
    setChatJoined(false);
  }, [isHost, sessionId]);

  useEffect(() => {
    if (sessionStatus !== 'LIVE') {
      connectGenRef.current += 1;
      setState(sessionStatus === 'ENDED' ? 'ended' : 'idle');
      return undefined;
    }

    const generation = ++connectGenRef.current;
    setState('connecting');
    setError('');

    const connect = () => {
      if (generation !== connectGenRef.current) return;
      setState('connected');
    };

    const unsubscribeMessages = subscribeRtcChat(sessionId, (message) => {
      if (generation !== connectGenRef.current) return;
      mergeMessages([message]);
    });

    let unsubscribeReady = () => undefined;
    if (isRtcChatReady(sessionId)) {
      connect();
    } else {
      unsubscribeReady = onRtcChatReady(sessionId, connect);
    }

    return () => {
      connectGenRef.current += 1;
      unsubscribeMessages();
      unsubscribeReady();
    };
  }, [mergeMessages, sessionId, sessionStatus]);

  function joinChat() {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setError('Enter a display name to join chat.');
      return;
    }
    setSessionChatName(sessionId, trimmed, isHost);
    setDisplayName(trimmed);
    setChatJoined(true);
    setError('');
  }

  async function sendMessage() {
    const text = draft.trim();
    if (!text || state !== 'connected' || !chatJoined) return;

    try {
      await sendRtcChat(sessionId, displayName, text);
      setDraft('');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send message');
    }
  }

  const notice =
    sessionStatus === 'LIVE' && state === 'connecting'
      ? isHost
        ? 'Chat opens when you go live with camera and mic.'
        : 'Chat opens when you join the live channel.'
      : '';

  const canJoinChat = state === 'connected' && nameDraft.trim().length > 0;
  const canSend = state === 'connected' && chatJoined;

  return {
    state,
    mode: canSend ? ('rtc' as const) : null,
    notice,
    error,
    displayName,
    nameDraft,
    chatJoined,
    canJoinChat,
    canSend,
    draft,
    messages,
    setNameDraft,
    setDraft,
    joinChat,
    sendMessage,
  };
}
