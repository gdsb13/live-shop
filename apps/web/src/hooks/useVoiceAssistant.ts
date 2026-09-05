'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { allocateVoiceShopperRtcUid, voiceShopperUserId } from '@/lib/agora/identity';
import { setLiveAudioDucked } from '@/lib/liveAudioBridge';
import { setReplayAudioDucked } from '@/lib/replayAudioBridge';
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
import {
  buildDisplayTranscript,
  isUserGoodbyeIntent,
  latestUserTurnId,
  type SdkTranscriptItem,
} from '@/lib/voice/transcriptTurns';
import type { Cart } from '@/lib/types';

const THINKING_FILLER_DELAY_MS = 1000;
const THINKING_FILLER_TEXT = 'Let me check that for you.';

async function resolveContext(pathname: string) {
  const liveMatch = pathname.match(/^\/live\/([^/]+)$/);
  if (liveMatch) {
    const liveSessionId = liveMatch[1];
    const session = await api.getLiveSession(liveSessionId);
    if (session.status === 'LIVE') {
      return { surface: 'live' as VoiceAssistantSurface, liveSessionId };
    }
    if (session.status === 'ENDED' || session.status === 'SCHEDULED') {
      return { surface: 'recorded' as VoiceAssistantSurface, liveSessionId };
    }
    return { surface: 'recorded' as VoiceAssistantSurface, liveSessionId };
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

export function useVoiceAssistant() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pollSessionId, setPollSessionId] = useState('');
  const [state, setState] = useState<VoiceAssistantState>('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [transcripts, setTranscripts] = useState<VoiceTranscriptLine[]>([]);
  const [micMuted, setMicMuted] = useState(false);
  const sessionIdRef = useRef('');
  const shopperUserIdRef = useRef(voiceShopperUserId());
  const shopperRtcUidRef = useRef(allocateVoiceShopperRtcUid());
  const agentUidRef = useRef<number | null>(null);
  const rtcClientRef = useRef<import('agora-rtc-sdk-ng').IAgoraRTCClient | null>(null);
  const micTrackRef = useRef<import('agora-rtc-sdk-ng').ILocalAudioTrack | null>(null);
  const voiceAiRuntimeRef = useRef<VoiceAiRuntime | null>(null);
  const audioAnchorRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef(false);
  const cartRefreshRef = useRef<(() => Promise<void>) | null>(null);
  const applyCartRef = useRef<((cart: Cart) => void) | null>(null);
  const farewellPendingRef = useRef(false);
  const farewellAssistantHeardRef = useRef(false);
  const farewellStopTimerRef = useRef<number | null>(null);
  const stopAssistantRef = useRef<(() => Promise<void>) | null>(null);
  const thinkingFillerTimerRef = useRef<number | null>(null);
  const thinkingFillerShownRef = useRef(false);
  const thinkingActiveRef = useRef(false);
  const sdkSnapshotRef = useRef<SdkTranscriptItem[]>([]);
  const agentSpeakingRef = useRef(false);
  const greetingCompleteRef = useRef(false);
  const fillerLineRef = useRef<VoiceTranscriptLine | null>(null);
  const lastFillerUserTurnRef = useRef<number | null>(null);
  const orderCompletedRef = useRef(false);

  const rebuildTranscriptDisplay = useCallback(() => {
    setTranscripts(
      buildDisplayTranscript(sdkSnapshotRef.current, {
        agentSpeaking: agentSpeakingRef.current,
        fillerLine: fillerLineRef.current,
      }),
    );
  }, []);

  const clearThinkingFillerTimer = useCallback(() => {
    if (thinkingFillerTimerRef.current !== null) {
      window.clearTimeout(thinkingFillerTimerRef.current);
      thinkingFillerTimerRef.current = null;
    }
  }, []);

  const clearFarewellState = useCallback(() => {
    farewellPendingRef.current = false;
    farewellAssistantHeardRef.current = false;
    if (farewellStopTimerRef.current !== null) {
      window.clearTimeout(farewellStopTimerRef.current);
      farewellStopTimerRef.current = null;
    }
  }, []);

  const resetThinkingFillerTurn = useCallback(() => {
    clearThinkingFillerTimer();
    thinkingFillerShownRef.current = false;
    fillerLineRef.current = null;
    rebuildTranscriptDisplay();
  }, [clearThinkingFillerTimer, rebuildTranscriptDisplay]);

  const maybeScheduleThinkingFiller = useCallback(() => {
    clearThinkingFillerTimer();
    const userTurnId = latestUserTurnId(sdkSnapshotRef.current);
    if (
      thinkingFillerShownRef.current ||
      !thinkingActiveRef.current ||
      (userTurnId !== null && lastFillerUserTurnRef.current === userTurnId)
    ) {
      return;
    }
    thinkingFillerTimerRef.current = window.setTimeout(() => {
      thinkingFillerTimerRef.current = null;
      if (!activeRef.current || !thinkingActiveRef.current || thinkingFillerShownRef.current) {
        return;
      }
      const activeUserTurnId = latestUserTurnId(sdkSnapshotRef.current);
      if (
        activeUserTurnId !== null &&
        lastFillerUserTurnRef.current === activeUserTurnId
      ) {
        return;
      }
      thinkingFillerShownRef.current = true;
      lastFillerUserTurnRef.current = activeUserTurnId;
      fillerLineRef.current = {
        role: 'assistant',
        text: THINKING_FILLER_TEXT,
        ts: new Date().toISOString(),
        final: true,
        filler: true,
      };
      rebuildTranscriptDisplay();
    }, THINKING_FILLER_DELAY_MS);
  }, [clearThinkingFillerTimer, rebuildTranscriptDisplay]);

  const cleanupVoiceStack = useCallback(async () => {
    const voiceAiRuntime = voiceAiRuntimeRef.current;
    voiceAiRuntimeRef.current = null;
    if (voiceAiRuntime) {
      try {
        await voiceAiRuntime.destroy();
      } catch {
        // Toolkit may already be torn down.
      }
    }

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

    await releaseVoiceRtmClient();

    try {
      micTrackRef.current?.stop();
      micTrackRef.current?.close();
    } catch {
      // Track may already be closed.
    }
    micTrackRef.current = null;
    setMicMuted(false);
    thinkingActiveRef.current = false;
    sdkSnapshotRef.current = [];
    agentSpeakingRef.current = false;
    greetingCompleteRef.current = false;
    fillerLineRef.current = null;
    lastFillerUserTurnRef.current = null;
    orderCompletedRef.current = false;
    resetThinkingFillerTurn();
  }, [resetThinkingFillerTurn]);

  const handleSessionEnded = useCallback(
    async (message: string) => {
      if (!activeRef.current) return;
      activeRef.current = false;
      setError(message);
      setState('error');
      setNotice('');
      clearFarewellState();
      await cleanupVoiceStack();
      setLiveAudioDucked(false);
      setReplayAudioDucked(false);
      setPollSessionId('');
      sessionIdRef.current = '';
    },
    [cleanupVoiceStack, clearFarewellState],
  );

  const stopAssistant = useCallback(async () => {
    activeRef.current = false;
    clearFarewellState();
    await cleanupVoiceStack();
    setLiveAudioDucked(false);
    setReplayAudioDucked(false);

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
  }, [cleanupVoiceStack, clearFarewellState]);

  stopAssistantRef.current = stopAssistant;

  const scheduleGracefulStopAfterFarewell = useCallback(() => {
    if (farewellStopTimerRef.current !== null) return;
    farewellStopTimerRef.current = window.setTimeout(() => {
      farewellStopTimerRef.current = null;
      if (!activeRef.current || !farewellPendingRef.current) return;
      stopAssistantRef.current?.().catch(() => undefined);
    }, 450);
  }, []);

  const toggleVoiceMicMuted = useCallback(async () => {
    const track = micTrackRef.current;
    if (!track || !activeRef.current) return;
    const nextMuted = !micMuted;
    try {
      await track.setEnabled(!nextMuted);
      setMicMuted(nextMuted);
    } catch {
      setNotice('Could not change microphone mute. Try again.');
    }
  }, [micMuted]);

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
        onTranscriptSnapshot: (snapshot) => {
          if (!activeRef.current) return;
          const previousUserTurn = latestUserTurnId(sdkSnapshotRef.current);
          sdkSnapshotRef.current = snapshot;
          const nextUserTurn = latestUserTurnId(snapshot);
          if (nextUserTurn !== null && nextUserTurn !== previousUserTurn) {
            thinkingFillerShownRef.current = false;
            fillerLineRef.current = null;
            clearThinkingFillerTimer();
          }
          rebuildTranscriptDisplay();
          for (const item of snapshot) {
            if (
              item.role === 'user' &&
              isUserGoodbyeIntent(item.text, { orderCompleted: orderCompletedRef.current })
            ) {
              farewellPendingRef.current = true;
              farewellAssistantHeardRef.current = false;
            }
            if (item.role === 'assistant' && farewellPendingRef.current && item.final) {
              farewellAssistantHeardRef.current = true;
            }
          }
        },
        onSpeaking: (active) => {
          if (!activeRef.current) return;
          agentSpeakingRef.current = active;
          if (active) {
            clearThinkingFillerTimer();
            fillerLineRef.current = null;
            setState('speaking');
          } else {
            if (!greetingCompleteRef.current) {
              greetingCompleteRef.current = true;
            }
            setState('listening');
            if (farewellPendingRef.current && farewellAssistantHeardRef.current) {
              scheduleGracefulStopAfterFarewell();
            }
          }
          rebuildTranscriptDisplay();
        },
        onThinking: (active) => {
          if (!activeRef.current) return;
          thinkingActiveRef.current = active;
          if (active) {
            setState('thinking');
            maybeScheduleThinkingFiller();
          } else {
            clearThinkingFillerTimer();
            if (!agentSpeakingRef.current) {
              setState(greetingCompleteRef.current ? 'listening' : 'connecting');
            }
          }
        },
        onAgentError: () => {
          if (!activeRef.current) return;
          setNotice('Assistant hit a brief error — you can keep speaking or tap Stop and try again.');
        },
      });

      if (activeRef.current && greetingCompleteRef.current) setState('listening');
    },
    [handleSessionEnded, maybeScheduleThinkingFiller, clearThinkingFillerTimer, rebuildTranscriptDisplay, resetThinkingFillerTurn, scheduleGracefulStopAfterFarewell],
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
        await new Promise((resolve) => window.setTimeout(resolve, 900));
      }

      clearFarewellState();
      resetThinkingFillerTurn();
      sdkSnapshotRef.current = [];
      agentSpeakingRef.current = false;
      greetingCompleteRef.current = false;
      fillerLineRef.current = null;
      lastFillerUserTurnRef.current = null;
      orderCompletedRef.current = false;
      setTranscripts([]);
      setError('');
      setNotice('');
      setMicMuted(false);
      setState('connecting');
      setOpen(true);
      activeRef.current = true;
      cartRefreshRef.current = refreshCart;
      applyCartRef.current = applyCart ?? null;
      agentUidRef.current = null;

      const context = await resolveContext(pathname);
      const shopperUserId = shopperUserIdRef.current;
      shopperRtcUidRef.current = allocateVoiceShopperRtcUid();

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
        } else if (context.surface === 'recorded') {
          setReplayAudioDucked(true);
        }

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

        setNotice('Private Agora voice session active. Speak naturally to the assistant.');
        if (activeRef.current && greetingCompleteRef.current) setState('listening');
      } catch (err) {
        activeRef.current = false;
        await cleanupVoiceStack();
        setLiveAudioDucked(false);
        setReplayAudioDucked(false);
        sessionIdRef.current = '';
        setPollSessionId('');
        setState('error');
        setError(err instanceof Error ? err.message : 'Could not start Voice AI');
      }
    },
    [cleanupVoiceStack, clearFarewellState, connectAgoraRtc, pathname, resetThinkingFillerTurn, subscribeAgentAudio],
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
          if (session.orderCompleted) {
            orderCompletedRef.current = true;
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
      if (!sessionIdRef.current && !rtcClientRef.current) return;
      activeRef.current = false;
      cleanupVoiceStack().catch(() => undefined);
    };
    // Unmount-only: do not depend on callback identity or Fast Refresh will kill a live call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    open,
    state,
    error,
    notice,
    transcripts,
    audioAnchorRef,
    startAssistant,
    stopAssistant,
    toggleVoiceMicMuted,
    micMuted,
    setOpen,
  };
}
