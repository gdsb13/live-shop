'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { allocateVoiceShopperRtcUid, voiceShopperUserId } from '@/lib/agora/identity';
import { useToast } from '@/components/ToastProvider';
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
  findFinalAssistantTurnAfterUserTurn,
  isUserGoodbyeIntent,
  isUserExplicitSessionEndIntent,
  shouldCancelFarewellPending,
  type SdkTranscriptItem,
} from '@/lib/voice/transcriptTurns';
import type { Cart } from '@/lib/types';

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
  const farewellAnchorTurnIdRef = useRef<number | null>(null);
  const farewellReplySeenAtRef = useRef<number | null>(null);
  const farewellSpeechHeardRef = useRef(false);
  const stoppingRef = useRef(false);
  const stopAssistantRef = useRef<
    ((reason?: 'user_stop' | 'farewell') => Promise<void>) | null
  >(null);
  const thinkingActiveRef = useRef(false);
  const sdkSnapshotRef = useRef<SdkTranscriptItem[]>([]);
  const agentSpeakingRef = useRef(false);
  const greetingCompleteRef = useRef(false);
  const orderCompletedRef = useRef(false);
  const orderToastedRef = useRef(false);
  const { showToast } = useToast();

  const rebuildTranscriptDisplay = useCallback(() => {
    setTranscripts(
      buildDisplayTranscript(sdkSnapshotRef.current, {
        agentSpeaking: agentSpeakingRef.current,
        agentThinking: thinkingActiveRef.current,
      }),
    );
  }, []);

  const clearFarewellState = useCallback(() => {
    farewellPendingRef.current = false;
    farewellAnchorTurnIdRef.current = null;
    farewellReplySeenAtRef.current = null;
    farewellSpeechHeardRef.current = false;
  }, []);

  const resetAgentUiState = useCallback(() => {
    thinkingActiveRef.current = false;
    rebuildTranscriptDisplay();
  }, [rebuildTranscriptDisplay]);

  const cleanupVoiceStack = useCallback(async (options?: { preserveTranscript?: boolean }) => {
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
    agentSpeakingRef.current = false;
    if (!options?.preserveTranscript) {
      sdkSnapshotRef.current = [];
      greetingCompleteRef.current = false;
      orderCompletedRef.current = false;
      resetAgentUiState();
    }
  }, [resetAgentUiState]);

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

  const stopAssistant = useCallback(async (reason: 'user_stop' | 'farewell' = 'user_stop') => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    activeRef.current = false;
    clearFarewellState();
    agentSpeakingRef.current = false;
    thinkingActiveRef.current = false;

    const sessionId = sessionIdRef.current;
    const shopperUserId = shopperUserIdRef.current;
    sessionIdRef.current = '';
    setPollSessionId('');

    if (reason === 'farewell') {
      setState('ended');
      setOpen(true);
      setNotice('');
      setError('');
    } else {
      setState('idle');
      setOpen(false);
      setNotice('');
      setError('');
    }

    try {
      await cleanupVoiceStack({ preserveTranscript: reason === 'farewell' });
      setLiveAudioDucked(false);
      setReplayAudioDucked(false);
      if (sessionId) {
        try {
          await api.stopVoiceAiSession({ sessionId, shopperUserId, reason });
        } catch {
          // ignore stop errors during cleanup
        }
      }
    } finally {
      stoppingRef.current = false;
    }
  }, [cleanupVoiceStack, clearFarewellState]);

  stopAssistantRef.current = stopAssistant;

  const tryCompleteSessionEnd = useCallback(() => {
    if (!activeRef.current || stoppingRef.current) return;
    if (!farewellPendingRef.current || farewellAnchorTurnIdRef.current === null) return;

    const anchorTurn = sdkSnapshotRef.current.find(
      (item) => item.role === 'user' && item.turnId === farewellAnchorTurnIdRef.current,
    );
    if (!anchorTurn) return;

    const assistantReply = findFinalAssistantTurnAfterUserTurn(
      sdkSnapshotRef.current,
      anchorTurn,
    );
    if (!assistantReply) return;

    if (farewellReplySeenAtRef.current === null) {
      farewellReplySeenAtRef.current = Date.now();
    }

    if (thinkingActiveRef.current) return;

    if (agentSpeakingRef.current) {
      farewellSpeechHeardRef.current = true;
      return;
    }

    // TEXT-mode transcript can finalize before TTS starts — wait for speech to play.
    if (!farewellSpeechHeardRef.current) {
      const elapsed = Date.now() - farewellReplySeenAtRef.current;
      if (elapsed < 3500) return;
    }

    stopAssistantRef.current?.('farewell').catch(() => undefined);
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
      const rtcSdk = AgoraRTC as typeof AgoraRTC & {
        setParameter(key: string, value: boolean): void;
      };
      rtcSdk.setParameter('ENABLE_AUDIO_PTS', true);
      rtcSdk.setParameter('ENABLE_AUDIO_PTS_METADATA', true);

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
          sdkSnapshotRef.current = snapshot;
          for (const item of snapshot) {
            if (item.role === 'user' && item.final) {
              console.info(
                `[VoiceAI Client] ${item.ts} event=user_transcript_final turn=${item.turnId} text=${JSON.stringify(item.text)}`,
              );
            }
          }
          rebuildTranscriptDisplay();
          if (!orderCompletedRef.current) {
            const latestAssistantOrderHint = [...snapshot]
              .reverse()
              .find(
                (item) =>
                  item.role === 'assistant' &&
                  item.final &&
                  /\b(order (id|has been|confirmed)|ord-[a-f0-9]{8})\b/i.test(item.text),
              );
            if (latestAssistantOrderHint) {
              orderCompletedRef.current = true;
            }
          }
          const latestUserTurn = [...snapshot]
            .reverse()
            .find((item) => item.role === 'user' && item.final);
          if (latestUserTurn) {
            if (isUserExplicitSessionEndIntent(latestUserTurn.text)) {
              stopAssistantRef.current?.('farewell').catch(() => undefined);
            } else if (isUserGoodbyeIntent(latestUserTurn.text, { orderCompleted: orderCompletedRef.current })) {
              farewellPendingRef.current = true;
              if (farewellAnchorTurnIdRef.current === null) {
                farewellAnchorTurnIdRef.current = latestUserTurn.turnId;
              }
            } else if (
              farewellPendingRef.current &&
              shouldCancelFarewellPending(latestUserTurn.text)
            ) {
              farewellPendingRef.current = false;
              farewellAnchorTurnIdRef.current = null;
            }
          }
          tryCompleteSessionEnd();
        },
        onSpeaking: (active) => {
          if (!activeRef.current) return;
          agentSpeakingRef.current = active;
          if (active) {
            if (farewellPendingRef.current) {
              farewellSpeechHeardRef.current = true;
            }
            setState('speaking');
          } else {
            if (!greetingCompleteRef.current) {
              greetingCompleteRef.current = true;
            }
            setState('listening');
            tryCompleteSessionEnd();
          }
          rebuildTranscriptDisplay();
        },
        onThinking: (active) => {
          if (!activeRef.current) return;
          thinkingActiveRef.current = active;
          if (active) {
            setState('thinking');
          } else if (!agentSpeakingRef.current) {
            setState(greetingCompleteRef.current ? 'listening' : 'connecting');
            tryCompleteSessionEnd();
          }
          rebuildTranscriptDisplay();
        },
        onAgentError: () => {
          if (!activeRef.current) return;
          thinkingActiveRef.current = false;
          if (!agentSpeakingRef.current) {
            setState(greetingCompleteRef.current ? 'listening' : 'connecting');
          }
          rebuildTranscriptDisplay();
          setNotice('Assistant hit a brief error — you can keep speaking or tap Stop and try again.');
        },
      });

      if (activeRef.current && greetingCompleteRef.current) setState('listening');
    },
    [handleSessionEnded, rebuildTranscriptDisplay, resetAgentUiState, tryCompleteSessionEnd],
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
            await api.stopVoiceAiSession({ sessionId: previousSessionId, shopperUserId, reason: 'user_stop' });
          } catch {
            // ignore stale stop errors
          }
        }
        sessionIdRef.current = '';
        setPollSessionId('');
        await new Promise((resolve) => window.setTimeout(resolve, 900));
      }

      clearFarewellState();
      resetAgentUiState();
      sdkSnapshotRef.current = [];
      agentSpeakingRef.current = false;
      greetingCompleteRef.current = false;
      orderCompletedRef.current = false;
      orderToastedRef.current = false;
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
    [cleanupVoiceStack, clearFarewellState, connectAgoraRtc, pathname, resetAgentUiState, subscribeAgentAudio],
  );

  useEffect(() => {
    if (!open || !pollSessionId) return undefined;

    const tick = () => {
      if (!activeRef.current) return;
      api
        .getVoiceAiSession(pollSessionId)
        .then(async (session) => {
          if (session.state === 'ended') {
            console.warn(
              `[VoiceAI Client] ${new Date().toISOString()} event=session_ended stopReason=${session.stopReason || 'unknown'}`,
            );
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
            showToast('Cart updated');
          }
          if (session.orderCompleted) {
            orderCompletedRef.current = true;
            if (session.lastOrderId && !orderToastedRef.current) {
              orderToastedRef.current = true;
              showToast(`Order placed successfully — ${session.lastOrderId}`);
            }
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
  }, [handleSessionEnded, open, pollSessionId, showToast]);

  useEffect(() => {
    return () => {
      if (!sessionIdRef.current && !rtcClientRef.current) return;
      activeRef.current = false;
      cleanupVoiceStack().catch(() => undefined);
    };
    // Unmount-only: do not depend on callback identity or Fast Refresh will kill a live call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismissPanel = useCallback(() => {
    setOpen(false);
    setState('idle');
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
    dismissPanel,
    toggleVoiceMicMuted,
    micMuted,
    setOpen,
  };
}
