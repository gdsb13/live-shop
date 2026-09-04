'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { attachRtcChat, detachRtcChat } from '@/lib/agora/rtcChatBridge';
import { hostUserId } from '@/lib/agora/identity';
import { joinRtcChannel, releaseRtcChannel } from '@/lib/agora/rtcSession';

type ConnectionState = 'idle' | 'connecting' | 'live' | 'ended' | 'error' | 'blocked';

const HOST_BLOCKED_MSG =
  'Host already broadcasting from another tab. End the other broadcast first.';

export function useHostBroadcast(
  sessionId: string,
  sessionStatus: string,
  onSessionChange?: () => void | Promise<void>,
) {
  const videoRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<import('agora-rtc-sdk-ng').IAgoraRTCClient | null>(null);
  const micRef = useRef<import('agora-rtc-sdk-ng').ILocalAudioTrack | null>(null);
  const camRef = useRef<import('agora-rtc-sdk-ng').ILocalVideoTrack | null>(null);
  const channelRef = useRef('');
  const userIdRef = useRef('');
  const localHostUserIdRef = useRef(hostUserId(sessionId));
  const hasClaimRef = useRef(false);
  const sessionLiveRef = useRef(sessionStatus === 'LIVE');
  const [state, setState] = useState<ConnectionState>('idle');
  const [statusText, setStatusText] = useState(
    'Click Go live with camera + mic to start broadcasting.',
  );
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const viewerUidsRef = useRef(new Set<string>());

  useEffect(() => {
    sessionLiveRef.current = sessionStatus === 'LIVE';
  }, [sessionStatus]);

  const releaseClaim = useCallback(async () => {
    if (!hasClaimRef.current) return;
    const userId = userIdRef.current || localHostUserIdRef.current;
    hasClaimRef.current = false;
    try {
      await api.releaseHostBroadcast({ liveSessionId: sessionId, userId });
    } catch {
      // ignore release errors during cleanup
    }
  }, [sessionId]);

  const cleanup = useCallback(async () => {
    micRef.current?.stop();
    micRef.current?.close();
    micRef.current = null;
    camRef.current?.stop();
    camRef.current?.close();
    camRef.current = null;
    setCameraOn(false);
    setMicOn(false);
    viewerUidsRef.current.clear();
    setViewerCount(0);

    const client = clientRef.current;
    const channelName = channelRef.current;
    const userId = userIdRef.current;

    clientRef.current = null;
    channelRef.current = '';
    userIdRef.current = '';

    if (client) {
      detachRtcChat(sessionId, client);
      if (channelName && userId) {
        await releaseRtcChannel(channelName, userId, client);
      } else {
        try {
          await client.leave();
        } catch {
          // ignore leave errors during cleanup
        }
      }
    }

    await releaseClaim();
  }, [releaseClaim, sessionId]);

  const refreshHostStatus = useCallback(async () => {
    if (sessionStatus !== 'SCHEDULED' && sessionStatus !== 'LIVE') return;
    try {
      const status = await api.getHostBroadcastStatus(sessionId);
      const mine = localHostUserIdRef.current;
      if (status.broadcasting && status.hostUserId !== mine && state !== 'live') {
        setState('blocked');
        setStatusText(HOST_BLOCKED_MSG);
        return;
      }
      setState((current) => (current === 'blocked' ? 'idle' : current));
      setStatusText((prev) =>
        prev === HOST_BLOCKED_MSG
          ? 'Click Go live with camera + mic to start broadcasting.'
          : prev,
      );
    } catch {
      // ignore polling errors
    }
  }, [sessionId, sessionStatus, state]);

  const endBroadcast = useCallback(async () => {
    await cleanup();
    try {
      if (sessionLiveRef.current) {
        await api.endLiveSession(sessionId);
        sessionLiveRef.current = false;
        await onSessionChange?.();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not end session';
      setStatusText(message);
      setState('error');
      return;
    }
    setState('ended');
    setStatusText('Broadcast ended.');
  }, [cleanup, onSessionChange, sessionId]);

  const goLive = useCallback(async () => {
    if (sessionStatus === 'ENDED') {
      setState('ended');
      setStatusText('This session has ended.');
      return;
    }

    const userId = localHostUserIdRef.current;
    userIdRef.current = userId;

    setState('connecting');
    setStatusText('Requesting token and camera/microphone access…');

    try {
      const creds = await api.getAgoraRtcToken({
        liveSessionId: sessionId,
        userId,
        role: 'host',
      });
      hasClaimRef.current = true;

      channelRef.current = creds.channelName;

      const AgoraRTC = (await import('agora-rtc-sdk-ng')).default;
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      clientRef.current = client;

      client.on('connection-state-change', (cur) => {
        if (cur === 'DISCONNECTED' && clientRef.current === client) {
          setState('idle');
          setStatusText('Disconnected from Agora. Click Go live to publish again.');
        }
      });

      const syncViewerCount = () => {
        setViewerCount(viewerUidsRef.current.size);
      };

      client.on('user-joined', (user) => {
        viewerUidsRef.current.add(String(user.uid));
        syncViewerCount();
      });

      client.on('user-left', (user) => {
        viewerUidsRef.current.delete(String(user.uid));
        syncViewerCount();
      });

      await joinRtcChannel(creds.channelName, creds.userId, client, () =>
        client.join(creds.appId, creds.channelName, creds.token, creds.userId),
      );
      attachRtcChat(sessionId, client);

      client.remoteUsers.forEach((user) => {
        viewerUidsRef.current.add(String(user.uid));
      });
      setViewerCount(viewerUidsRef.current.size);

      const [micTrack, camTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
      micRef.current = micTrack;
      camRef.current = camTrack;
      setMicOn(micTrack.enabled);
      setCameraOn(camTrack.enabled);

      if (videoRef.current) {
        camTrack.play(videoRef.current);
      }

      await client.publish([micTrack, camTrack]);

      // Application LIVE follows successful Agora publish; API does not verify RTC presence.
      if (!sessionLiveRef.current) {
        await api.startLiveSession(sessionId);
        sessionLiveRef.current = true;
        await onSessionChange?.();
      }

      setState('live');
      setStatusText('You are live. Viewers can watch on the session page.');
    } catch (err) {
      await cleanup();
      const message = err instanceof Error ? err.message : 'Could not start broadcast';
      if (message.includes('Host already broadcasting')) {
        setState('blocked');
        setStatusText(HOST_BLOCKED_MSG);
        return;
      }
      if (
        message.toLowerCase().includes('notreadable') ||
        message.toLowerCase().includes('not readable')
      ) {
        setState('blocked');
        setStatusText(
          'Camera or microphone is in use by another tab. Close the other host tab or end that broadcast.',
        );
        return;
      }
      if (message.toLowerCase().includes('permission') || message.toLowerCase().includes('notallowed')) {
        setStatusText('Camera or microphone permission denied. Allow access and try again.');
      } else {
        setStatusText(message);
      }
      setState('error');
    }
  }, [cleanup, onSessionChange, sessionId, sessionStatus]);

  useEffect(() => {
    if ((sessionStatus !== 'SCHEDULED' && sessionStatus !== 'LIVE') || state === 'live') {
      return undefined;
    }

    refreshHostStatus().catch(() => undefined);
    const interval = setInterval(() => {
      refreshHostStatus().catch(() => undefined);
    }, 3000);

    return () => clearInterval(interval);
  }, [refreshHostStatus, sessionStatus, state]);

  useEffect(() => {
    if (state !== 'live') return undefined;

    const userId = userIdRef.current || localHostUserIdRef.current;
    const interval = setInterval(() => {
      api.heartbeatHostBroadcast({ liveSessionId: sessionId, userId }).catch(() => undefined);
    }, 20000);

    return () => clearInterval(interval);
  }, [sessionId, state]);

  useEffect(() => {
    if (sessionStatus === 'ENDED') {
      cleanup().then(() => {
        setState('ended');
        setStatusText('Session ended. Broadcast stopped.');
      });
    }
  }, [cleanup, sessionStatus]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  async function toggleCamera() {
    const cam = camRef.current;
    if (!cam) return;
    await cam.setEnabled(!cam.enabled);
    setCameraOn(cam.enabled);
  }

  async function toggleMic() {
    const mic = micRef.current;
    if (!mic) return;
    await mic.setEnabled(!mic.enabled);
    setMicOn(mic.enabled);
  }

  return {
    videoRef,
    state,
    statusText,
    cameraOn,
    micOn,
    viewerCount,
    broadcastBlocked: state === 'blocked',
    goLive,
    toggleCamera,
    toggleMic,
    endBroadcast,
  };
}
