'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { voiceShopperUserId } from '@/lib/agora/identity';
import { setLiveAudioDucked } from '@/lib/liveAudioBridge';
import { speakText, stopSpeaking } from '@/lib/voice/speech';
import type {
  VoiceAssistantState,
  VoiceAssistantSurface,
  VoiceTranscriptLine,
} from '@/lib/voice/types';

type SpeechRecognitionType = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEvent = {
  results: ArrayLike<{ 0: { transcript: string } }>;
};

function getSpeechRecognitionCtor():
  | (new () => SpeechRecognitionType)
  | undefined {
  if (typeof window === 'undefined') return undefined;
  const win = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionType;
    webkitSpeechRecognition?: new () => SpeechRecognitionType;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition;
}

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

export function useVoiceAssistant() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<VoiceAssistantState>('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [transcripts, setTranscripts] = useState<VoiceTranscriptLine[]>([]);
  const sessionIdRef = useRef('');
  const shopperUserIdRef = useRef(voiceShopperUserId());
  const rtcClientRef = useRef<import('agora-rtc-sdk-ng').IAgoraRTCClient | null>(null);
  const micTrackRef = useRef<import('agora-rtc-sdk-ng').ILocalAudioTrack | null>(null);
  const recognitionRef = useRef<SpeechRecognitionType | null>(null);
  const modeRef = useRef<'agora' | 'local'>('local');
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const cartRefreshRef = useRef<(() => Promise<void>) | null>(null);

  const cleanupRtc = useCallback(async () => {
    micTrackRef.current?.stop();
    micTrackRef.current?.close();
    micTrackRef.current = null;
    const client = rtcClientRef.current;
    rtcClientRef.current = null;
    if (client) {
      try {
        await client.leave();
      } catch {
        // ignore cleanup errors
      }
    }
  }, []);

  const stopRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition.onend = null;
    recognition.onresult = null;
    recognition.stop();
    recognitionRef.current = null;
  }, []);

  const stopAssistant = useCallback(async () => {
    activeRef.current = false;
    busyRef.current = false;
    stopRecognition();
    stopSpeaking();
    await cleanupRtc();
    setLiveAudioDucked(false);

    const sessionId = sessionIdRef.current;
    const shopperUserId = shopperUserIdRef.current;
    sessionIdRef.current = '';

    if (sessionId) {
      try {
        await api.stopVoiceAiSession({ sessionId, shopperUserId });
      } catch {
        // ignore stop errors during cleanup
      }
    }

    setState('idle');
    setOpen(false);
  }, [cleanupRtc, stopRecognition]);

  const speakLocal = useCallback((text: string, onComplete?: () => void) => {
    busyRef.current = true;
    stopRecognition();
    setState('speaking');
    speakText(text, () => {
      busyRef.current = false;
      if (activeRef.current) {
        setState('listening');
        onComplete?.();
      }
    });
  }, [stopRecognition]);

  const handleLocalTurn = useCallback(
    async (text: string) => {
      if (!sessionIdRef.current || busyRef.current) return;
      busyRef.current = true;
      stopRecognition();
      setState('thinking');
      try {
        const result = await api.sendVoiceAiLocalTurn({
          sessionId: sessionIdRef.current,
          text,
        });
        setTranscripts(result.transcripts);
        if (result.cartUpdated) {
          await cartRefreshRef.current?.();
        }
        speakLocal(result.reply, () => {
          if (result.endSession) {
            stopAssistant().catch(() => undefined);
            return;
          }
          if (activeRef.current) startListeningRef.current();
        });
      } catch (err) {
        busyRef.current = false;
        setError(err instanceof Error ? err.message : 'Voice turn failed');
        setState('error');
      }
    },
    [speakLocal, stopRecognition, stopAssistant],
  );

  const startListeningRef = useRef<() => void>(() => undefined);

  startListeningRef.current = () => {
    if (!activeRef.current || busyRef.current || modeRef.current !== 'local') return;

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError('Speech recognition is not supported in this browser. Try Chrome or Edge.');
      setState('error');
      return;
    }

    stopRecognition();

    const recognition = new Ctor();
    recognition.lang = 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript.trim();
      if (!text || busyRef.current) return;
      setTranscripts((prev) => [
        ...prev,
        { role: 'user', text, ts: new Date().toISOString() },
      ]);
      handleLocalTurn(text).catch((err: Error) => {
        setError(err.message);
        setState('error');
      });
    };

    recognition.onerror = (event) => {
      if (!activeRef.current || busyRef.current) return;
      const code = event.error || '';
      if (code === 'aborted' || code === 'no-speech') {
        window.setTimeout(() => {
          if (activeRef.current && !busyRef.current) startListeningRef.current();
        }, 400);
        return;
      }
      setState('listening');
    };

    recognition.onend = () => {
      if (!activeRef.current || busyRef.current) return;
      window.setTimeout(() => {
        if (activeRef.current && !busyRef.current && !recognitionRef.current) {
          startListeningRef.current();
        }
      }, 400);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setState('listening');
  };

  const connectAgoraRtc = useCallback(
    async (startPayload: import('@/lib/voice/types').VoiceSessionStart) => {
      if (!startPayload.appId || !startPayload.rtcToken) {
        throw new Error('Missing Agora RTC credentials for voice session');
      }
      const AgoraRTC = (await import('agora-rtc-sdk-ng')).default;
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      rtcClientRef.current = client;

      client.on('user-published', async (remoteUser, mediaType) => {
        if (mediaType !== 'audio') return;
        await client.subscribe(remoteUser, 'audio');
        busyRef.current = true;
        setState('speaking');
        remoteUser.audioTrack?.play();
      });

      client.on('user-unpublished', (_remoteUser, mediaType) => {
        if (mediaType === 'audio' && activeRef.current) {
          busyRef.current = false;
          setState('listening');
        }
      });

      await client.join(
        startPayload.appId,
        startPayload.channel,
        startPayload.rtcToken,
        startPayload.shopperUserId,
      );

      const micTrack = await AgoraRTC.createMicrophoneAudioTrack();
      micTrackRef.current = micTrack;
      await client.publish([micTrack]);
      setState('listening');
    },
    [],
  );

  const startAssistant = useCallback(
    async (refreshCart: () => Promise<void>) => {
      setError('');
      setNotice('');
      setState('connecting');
      setOpen(true);
      activeRef.current = true;
      busyRef.current = false;
      cartRefreshRef.current = refreshCart;

      const context = deriveContext(pathname);
      const shopperUserId = shopperUserIdRef.current;

      try {
        const startPayload = await api.startVoiceAiSession({
          surface: context.surface,
          shopperUserId,
          liveSessionId: context.liveSessionId,
          productId: context.productId,
        });

        sessionIdRef.current = startPayload.sessionId;
        modeRef.current = startPayload.mode;

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

        if (startPayload.mode === 'agora') {
          await connectAgoraRtc(startPayload);
          if (!startPayload.publicBaseConfigured) {
            setNotice('Agora voice is active on a private RTC channel.');
          }
        } else {
          setNotice(
            'Local voice assist is active. Set AI_PUBLIC_BASE_URL on the API for full Agora Conversational AI cloud mode.',
          );
          speakLocal(startPayload.greeting, () => {
            if (activeRef.current) startListeningRef.current();
          });
        }
      } catch (err) {
        activeRef.current = false;
        busyRef.current = false;
        await cleanupRtc();
        setLiveAudioDucked(false);
        sessionIdRef.current = '';
        setState('error');
        setError(err instanceof Error ? err.message : 'Could not start Voice AI');
      }
    },
    [cleanupRtc, connectAgoraRtc, pathname, speakLocal],
  );

  useEffect(() => {
    if (!open || modeRef.current !== 'agora' || !sessionIdRef.current) return undefined;

    const poll = window.setInterval(() => {
      const sessionId = sessionIdRef.current;
      if (!sessionId || !activeRef.current) return;
      api
        .getVoiceAiSession(sessionId)
        .then(async (session) => {
          setTranscripts(session.transcripts);
          if (session.cartUpdated) {
            await cartRefreshRef.current?.();
          }
        })
        .catch(() => undefined);
    }, 2000);

    return () => window.clearInterval(poll);
  }, [open, state]);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      busyRef.current = false;
      stopAssistant().catch(() => undefined);
    };
  }, [stopAssistant]);

  return {
    open,
    state,
    error,
    notice,
    transcripts,
    startAssistant,
    stopAssistant,
    setOpen,
  };
}
