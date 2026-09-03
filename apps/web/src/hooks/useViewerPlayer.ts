'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { attachRtcChat, detachRtcChat } from '@/lib/agora/rtcChatBridge';
import { viewerRtcUserId } from '@/lib/agora/identity';
import { joinRtcChannel, releaseRtcChannel } from '@/lib/agora/rtcSession';
import { onLiveAudioDuck } from '@/lib/liveAudioBridge';

type ConnectionState = 'idle' | 'connecting' | 'watching' | 'waiting' | 'ended' | 'error';

export function useViewerPlayer(sessionId: string, sessionStatus: string) {
  const videoRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<import('agora-rtc-sdk-ng').IAgoraRTCClient | null>(null);
  const hostAudioTracksRef = useRef<Array<import('agora-rtc-sdk-ng').IRemoteAudioTrack | null>>([]);
  const userIdRef = useRef('');
  const channelRef = useRef('');
  const connectGenRef = useRef(0);
  const [state, setState] = useState<ConnectionState>('idle');
  const [statusText, setStatusText] = useState('');

  const cleanup = useCallback(async () => {
    hostAudioTracksRef.current = [];
    const client = clientRef.current;
    const userId = userIdRef.current;
    const channelName = channelRef.current;

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
          // ignore
        }
      }
    }
  }, [sessionId]);

  const connect = useCallback(async () => {
    if (sessionStatus !== 'LIVE') return;

    const generation = ++connectGenRef.current;
    setState('connecting');
    setStatusText('Joining live stream…');

    const userId = viewerRtcUserId(sessionId);
    userIdRef.current = userId;

    try {
      const creds = await api.getAgoraRtcToken({
        liveSessionId: sessionId,
        userId,
        role: 'audience',
      });
      if (generation !== connectGenRef.current) return;

      const AgoraRTC = (await import('agora-rtc-sdk-ng')).default;
      if (generation !== connectGenRef.current) return;

      channelRef.current = creds.channelName;

      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      clientRef.current = client;

      client.on('user-published', async (remoteUser, mediaType) => {
        if (generation !== connectGenRef.current) return;
        if (mediaType === 'datachannel') return;
        await client.subscribe(remoteUser, mediaType);
        if (mediaType === 'video' && remoteUser.videoTrack && videoRef.current) {
          remoteUser.videoTrack.play(videoRef.current);
          setState('watching');
          setStatusText('Watching host live.');
        }
        if (mediaType === 'audio' && remoteUser.audioTrack) {
          remoteUser.audioTrack.play();
          hostAudioTracksRef.current.push(remoteUser.audioTrack);
        }
      });

      client.on('user-unpublished', (_remoteUser, mediaType) => {
        if (generation !== connectGenRef.current) return;
        if (mediaType === 'datachannel') return;
        const stillPublishing = client.remoteUsers.some((user) => user.hasVideo || user.hasAudio);
        if (stillPublishing) return;
        setState('waiting');
        setStatusText('Host stopped publishing. Waiting for host…');
      });

      client.on('user-left', () => {
        if (generation !== connectGenRef.current) return;
        if (client.remoteUsers.length > 0) return;
        setState('waiting');
        setStatusText('Host left the channel. Waiting for host…');
      });

      await joinRtcChannel(creds.channelName, creds.userId, client, () =>
        client.join(creds.appId, creds.channelName, creds.token, creds.userId),
      );
      if (generation !== connectGenRef.current) {
        await releaseRtcChannel(creds.channelName, creds.userId, client);
        return;
      }

      attachRtcChat(sessionId, client);

      const remoteUsers = client.remoteUsers;
      if (remoteUsers.length === 0) {
        setState('waiting');
        setStatusText('Connected. Waiting for host to start broadcasting…');
        return;
      }

      for (const remoteUser of remoteUsers) {
        if (remoteUser.hasVideo) {
          await client.subscribe(remoteUser, 'video');
          if (remoteUser.videoTrack && videoRef.current) {
            remoteUser.videoTrack.play(videoRef.current);
          }
        }
        if (remoteUser.hasAudio) {
          await client.subscribe(remoteUser, 'audio');
          remoteUser.audioTrack?.play();
          if (remoteUser.audioTrack) {
            hostAudioTracksRef.current.push(remoteUser.audioTrack);
          }
        }
      }

      const hasVideo = remoteUsers.some((user) => user.hasVideo);
      setState(hasVideo ? 'watching' : 'waiting');
      setStatusText(
        hasVideo ? 'Watching host live.' : 'Connected. Waiting for host to start broadcasting…',
      );
    } catch (err) {
      if (generation !== connectGenRef.current) return;
      await cleanup();
      setState('error');
      setStatusText(err instanceof Error ? err.message : 'Could not join live stream');
    }
  }, [cleanup, sessionId, sessionStatus]);

  useEffect(() => {
    if (sessionStatus === 'SCHEDULED') {
      connectGenRef.current += 1;
      cleanup()
        .catch(() => undefined)
        .then(() => {
          setState('idle');
          setStatusText('This session has not started yet.');
        });
      return () => {
        connectGenRef.current += 1;
        cleanup().catch(() => undefined);
      };
    }

    if (sessionStatus === 'ENDED') {
      connectGenRef.current += 1;
      cleanup()
        .catch(() => undefined)
        .then(() => {
          setState('ended');
          setStatusText('This session has ended.');
        });
      return () => {
        connectGenRef.current += 1;
        cleanup().catch(() => undefined);
      };
    }

    if (sessionStatus === 'LIVE') {
      connect().catch(() => undefined);
      return () => {
        connectGenRef.current += 1;
        cleanup().catch(() => undefined);
      };
    }

    return undefined;
  }, [cleanup, connect, sessionStatus]);

  useEffect(() => {
    return onLiveAudioDuck((ducked) => {
      hostAudioTracksRef.current.forEach((track) => {
        track?.setVolume(ducked ? 0 : 100);
      });
    });
  }, []);

  return { videoRef, state, statusText };
}
