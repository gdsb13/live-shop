'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { voiceShopperRtcUid, voiceShopperUserId } from '@/lib/agora/identity';
import { setLiveAudioDucked } from '@/lib/liveAudioBridge';
import {
  createVoiceRtmClient,
  initVoiceAiToolkit,
  playRemoteAudioTrack,
  releaseVoiceRtmClient,
  type VoiceAiRuntime,
} from '@/lib/voice/voiceAiClient';
import type {
  VoiceAssistantState,
  VoiceAssistantSurface,
  VoiceTranscriptLine,
} from '@/lib/voice/types';
import type { Cart } from '@/lib/types';

const GREETING_MIC_MUTE_MS = 5000;

function deriveContext(pathname: string) {
  const liveMatch = pathname.match(/^\/live\/([^/]+)$/);
  if (liveMatch) {
    return { surface: 'live' as VoiceAssistantSurface, liveSessionId: liveMatch[1] };
  }
  const productMatch = pathname.match(/^\/products\/([^/]+)$/);
  if (productMatch) {
    return { surface: 'product' as VoiceAssistantSurface, productId: productMatch[1] };
  }
  return { surface: 'storefront' as VoiceAssistantSurface };
}

function isAgentRemoteUser(
  remoteUid: string | number,
  agentUid: number | null,
  shopperRtcUid: number,
) {
  const uid = Number(remoteUid);
  if (uid === shopperRtcUid) return false;
  if (agentUid && uid === agentUid) return true;
  return !agentUid;
}

function compactTranscriptText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isIncrementalTranscript(prev: string, next: string): boolean {
  const previous = compactTranscriptText(prev);
  const incoming = compactTranscriptText(next);
  if (!previous || !incoming) return false;
  if (previous === incoming) return true;
  return incoming.startsWith(previous) || previous.startsWith(incoming);
}

function coalesceTranscriptLines(lines: VoiceTranscriptLine[]): VoiceTranscriptLine[] {
  const next: VoiceTranscriptLine[] = [];
  for (const line of lines) {
    if (!line.text?.trim()) continue;
    const last = next[next.length - 1];
    if (last && last.role === line.role && isIncrementalTranscript(last.text, line.text)) {
      const keepLonger = line.text.length >= last.text.length ? line : last;
      next[next.length - 1] = {
        role: line.role,
        text: keepLonger.text,
        ts: line.ts || last.ts,
      };
      continue;
    }
    const key = `${line.role}:${compactTranscriptText(line.text)}`;
    if (next.some((entry) => `${entry.role}:${compactTranscriptText(entry.text)}` === key)) {
      continue;
    }
    next.push(line);
  }
  return next;
}

function mergeTranscripts(
  current: VoiceTranscriptLine[],
  incoming: VoiceTranscriptLine[],
): VoiceTranscriptLine[] {
  if (!incoming.length) return current;
  const next = current.slice();
  for (const line of coalesceTranscriptLines(incoming)) {
    const last = next[next.length - 1];
    if (last && last.role === line.role && isIncrementalTranscript(last.text, line.text)) {
      const keepLonger = line.text.length >= last.text.length ? line : last;
      next[next.length - 1] = {
        role: line.role,
        text: keepLonger.text,
        ts: line.ts || last.ts,
      };
      continue;
    }
    const key = `${line.role}:${compactTranscriptText(line.text)}`;
    if (next.some((entry) => `${entry.role}:${compactTranscriptText(entry.text)}` === key)) {
      continue;
    }
    next.push(line);
  }
  return next.slice(-40);
}

export function useVoiceAssistant() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pollSessionId, setPollSessionId] = useState('');
  const [state, setState] = useState<VoiceAssistantState>('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [transcripts, setTranscripts] = useState<VoiceTranscriptLine[]>([]);
  const sessionIdRef = useRef('');
  const shopperUserIdRef = useRef(voiceShopperUserId());
  const shopperRtcUidRef = useRef(voiceShopperRtcUid());
  const agentUidRef = useRef<number | null>(null);
  const rtcClientRef = useRef<import('agora-rtc-sdk-ng').IAgoraRTCClient | null>(null);
  const micTrackRef = useRef<import('agora-rtc-sdk-ng').ILocalAudioTrack | null>(null);
  const voiceAiRuntimeRef = useRef<VoiceAiRuntime | null>(null);
  const audioAnchorRef = useRef<HTMLDivElement | null>(null);
  const unmuteTimerRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const cartRefreshRef = useRef<(() => Promise<void>) | null>(null);
  const applyCartRef = useRef<((cart: Cart) => void) | null>(null);

  const cleanupVoiceStack = useCallback(async () => {
    if (unmuteTimerRef.current) {
      window.clearTimeout(unmuteTimerRef.current);
      unmuteTimerRef.current = null;
    }

    const voiceAiRuntime = voiceAiRuntimeRef.current;
    voiceAiRuntimeRef.current = null;
    if (voiceAiRuntime) {
      await voiceAiRuntime.destroy();
    } else {
      await releaseVoiceRtmClient();
    }

    micTrackRef.current?.stop();
    micTrackRef.current?.close();
    micTrackRef.current = null;

    const client = rtcClientRef.current;
    rtcClientRef.current = null;
    agentUidRef.current = null;

    if (client) {
      try {
        await client.leave();
      } catch {
        // ignore cleanup errors
      }
    }
  }, []);

  const handleSessionEnded = useCallback(
    async (message: string) => {
      if (!activeRef.current) return;
      activeRef.current = false;
      setError(message);
      setState('error');
      setNotice('');
      await cleanupVoiceStack();
      setLiveAudioDucked(false);
      setPollSessionId('');
      sessionIdRef.current = '';
    },
    [cleanupVoiceStack],
  );

  const stopAssistant = useCallback(async () => {
    activeRef.current = false;
    await cleanupVoiceStack();
    setLiveAudioDucked(false);

    const sessionId = sessionIdRef.current;
    const shopperUserId = shopperUserIdRef.current;
    sessionIdRef.current = '';
    setPollSessionId('');

    if (sessionId) {
      try {
        await api.stopVoiceAiSession({ sessionId, shopperUserId });
      } catch {
        // ignore stop errors during cleanup
      }
    }

    setState('idle');
    setOpen(false);
  }, [cleanupVoiceStack]);

  const subscribeAgentAudio = useCallback(
    async (client: import('agora-rtc-sdk-ng').IAgoraRTCClient) => {
      for (const remoteUser of client.remoteUsers) {
        if (!remoteUser.hasAudio) continue;
        if (
          !isAgentRemoteUser(remoteUser.uid, agentUidRef.current, shopperRtcUidRef.current)
        ) {
          continue;
        }
        await client.subscribe(remoteUser, 'audio');
        if (activeRef.current) setState('speaking');
        await playRemoteAudioTrack(remoteUser.audioTrack, audioAnchorRef.current);
      }
    },
    [],
  );

  const connectAgoraRtc = useCallback(
    async (startPayload: import('@/lib/voice/types').VoiceSessionStart) => {
      if (!startPayload.appId || !startPayload.rtcToken) {
        throw new Error('Missing Agora RTC credentials for voice session');
      }

      const AgoraRTC = (await import('agora-rtc-sdk-ng')).default;
      AgoraRTC.setParameter('ENABLE_AUDIO_PTS', true);
      AgoraRTC.setParameter('ENABLE_AUDIO_PTS_METADATA', true);

      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      rtcClientRef.current = client;

      client.on('user-published', async (remoteUser, mediaType) => {
        if (mediaType !== 'audio' || !activeRef.current) return;
        if (
          !isAgentRemoteUser(remoteUser.uid, agentUidRef.current, shopperRtcUidRef.current)
        ) {
          return;
        }
        await client.subscribe(remoteUser, 'audio');
        setState('speaking');
        await playRemoteAudioTrack(remoteUser.audioTrack, audioAnchorRef.current);
      });

      client.on('user-unpublished', (remoteUser, mediaType) => {
        if (mediaType !== 'audio' || !activeRef.current) return;
        if (
          !isAgentRemoteUser(remoteUser.uid, agentUidRef.current, shopperRtcUidRef.current)
        ) {
          return;
        }
        setState('listening');
      });

      client.on('user-left', (remoteUser) => {
        if (!activeRef.current) return;
        if (
          !isAgentRemoteUser(remoteUser.uid, agentUidRef.current, shopperRtcUidRef.current)
        ) {
          return;
        }
        handleSessionEnded(
          'Voice assistant disconnected. Tap Try again to start a new session.',
        ).catch(() => undefined);
      });

      await client.join(
        startPayload.appId,
        startPayload.channel,
        startPayload.rtcToken,
        startPayload.shopperRtcUid,
      );

      const micTrack = await AgoraRTC.createMicrophoneAudioTrack();
      micTrackRef.current = micTrack;
      await client.publish([micTrack]);
      // Mute uplink during greeting — publish requires an enabled track.
      await micTrack.setMuted(true);

      const rtmClient = await createVoiceRtmClient(
        startPayload.appId,
        startPayload.shopperRtcUid,
        startPayload.rtmToken,
        startPayload.channel,
      );

      voiceAiRuntimeRef.current = await initVoiceAiToolkit({
        rtcClient: client,
        rtmClient,
        channel: startPayload.channel,
        shopperRtcUid: startPayload.shopperRtcUid,
        onTranscripts: (lines) => {
          if (!activeRef.current || lines.length === 0) return;
          setTranscripts((prev) => mergeTranscripts(prev, lines));
        },
        onSpeaking: (active) => {
          if (!activeRef.current) return;
          setState(active ? 'speaking' : 'listening');
        },
        onThinking: (active) => {
          if (!activeRef.current) return;
          setState(active ? 'thinking' : 'listening');
        },
      });

      if (activeRef.current) setState('listening');
    },
    [handleSessionEnded],
  );

  const startAssistant = useCallback(
    async (refreshCart: () => Promise<void>, applyCart?: (cart: Cart) => void) => {
      if (activeRef.current || sessionIdRef.current || rtcClientRef.current) {
        const previousSessionId = sessionIdRef.current;
        const shopperUserId = shopperUserIdRef.current;
        activeRef.current = false;
        await cleanupVoiceStack();
        if (previousSessionId) {
          try {
            await api.stopVoiceAiSession({ sessionId: previousSessionId, shopperUserId });
          } catch {
            // ignore stale stop errors
          }
        }
        sessionIdRef.current = '';
        setPollSessionId('');
        await new Promise((resolve) => window.setTimeout(resolve, 450));
      }

      setError('');
      setNotice('');
      setState('connecting');
      setOpen(true);
      activeRef.current = true;
      cartRefreshRef.current = refreshCart;
      applyCartRef.current = applyCart ?? null;
      agentUidRef.current = null;

      const context = deriveContext(pathname);
      const shopperUserId = shopperUserIdRef.current;

      try {
        const startPayload = await api.startVoiceAiSession({
          surface: context.surface,
          shopperUserId,
          shopperRtcUid: shopperRtcUidRef.current,
          liveSessionId: context.liveSessionId,
          productId: context.productId,
        });

        sessionIdRef.current = startPayload.sessionId;
        setPollSessionId(startPayload.sessionId);

        if (context.surface === 'live') {
          setLiveAudioDucked(true);
        }

        setTranscripts([
          {
            role: 'assistant',
            text: startPayload.greeting,
            ts: new Date().toISOString(),
          },
        ]);

        await connectAgoraRtc(startPayload);

        const activatePayload = await api.activateVoiceAiSession({
          sessionId: startPayload.sessionId,
          shopperUserId,
        });
        agentUidRef.current = activatePayload.agentUid ?? null;

        const client = rtcClientRef.current;
        if (client) {
          await subscribeAgentAudio(client);
        }

        unmuteTimerRef.current = window.setTimeout(() => {
          unmuteTimerRef.current = null;
          if (!activeRef.current) return;
          micTrackRef.current?.setMuted(false).catch(() => undefined);
        }, GREETING_MIC_MUTE_MS);

        setNotice('Private Agora voice session active. Speak naturally to the assistant.');
        if (activeRef.current) setState('listening');
      } catch (err) {
        activeRef.current = false;
        await cleanupVoiceStack();
        setLiveAudioDucked(false);
        sessionIdRef.current = '';
        setPollSessionId('');
        setState('error');
        setError(err instanceof Error ? err.message : 'Could not start Voice AI');
      }
    },
    [cleanupVoiceStack, connectAgoraRtc, pathname, subscribeAgentAudio],
  );

  useEffect(() => {
    if (!open || !pollSessionId) return undefined;

    const tick = () => {
      if (!activeRef.current) return;
      api
        .getVoiceAiSession(pollSessionId)
        .then(async (session) => {
          if (session.state === 'ended') {
            await handleSessionEnded(
              'Voice assistant session ended. Tap Try again to start a new session.',
            );
            return;
          }
          if (session.cart) {
            applyCartRef.current?.(session.cart);
          }
          if (session.cartUpdated) {
            await cartRefreshRef.current?.();
          }
        })
        .catch(async (err: unknown) => {
          if (!activeRef.current) return;
          const message = err instanceof Error ? err.message : '';
          if (message.includes('404') || message.toLowerCase().includes('not found')) {
            await handleSessionEnded(
              'Voice assistant session expired. Tap Try again to start a new session.',
            );
          }
        });
    };

    tick();
    const poll = window.setInterval(tick, 1000);
    return () => window.clearInterval(poll);
  }, [handleSessionEnded, open, pollSessionId]);

  useEffect(() => {
    return () => {
      if (!sessionIdRef.current) return;
      activeRef.current = false;
      stopAssistant().catch(() => undefined);
    };
  }, [stopAssistant]);

  return {
    open,
    state,
    error,
    notice,
    transcripts,
    audioAnchorRef,
    startAssistant,
    stopAssistant,
    setOpen,
  };
}
