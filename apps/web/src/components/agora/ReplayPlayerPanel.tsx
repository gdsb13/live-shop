'use client';

import { useEffect, useRef, useState } from 'react';
import { onReplayAudioDuck, REPLAY_DUCKED_VOLUME } from '@/lib/replayAudioBridge';

function resolvePlaybackUrl(sessionId: string, recordingUrl: string | null | undefined) {
  if (recordingUrl && recordingUrl.startsWith('/')) {
    return recordingUrl;
  }
  if (recordingUrl && recordingUrl.startsWith('http')) {
    return `/api/live-sessions/${encodeURIComponent(sessionId)}/recording`;
  }
  return '';
}

export function ReplayPlayerPanel({
  sessionId,
  recordingUrl,
  title,
}: {
  sessionId: string;
  recordingUrl?: string | null;
  title: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const volumeRestoreRef = useRef(1);
  const [error, setError] = useState('');
  const playbackUrl = resolvePlaybackUrl(sessionId, recordingUrl);

  useEffect(() => {
    return onReplayAudioDuck((ducked) => {
      const video = videoRef.current;
      if (!video) return;
      if (ducked) {
        volumeRestoreRef.current = video.volume;
        video.volume = REPLAY_DUCKED_VOLUME;
        return;
      }
      video.volume = volumeRestoreRef.current;
    });
  }, []);

  if (!playbackUrl) {
    return (
      <div className="agora-panel panel media-placeholder">
        <div className="media-placeholder-inner">
          <span className="media-placeholder-label">Session ended</span>
          <p>No recording is available for this session yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="agora-panel panel replay-panel">
      <div className="agora-panel-header">
        <h3>Recorded replay</h3>
        <span className="agora-state-pill ended">RECORDED</span>
      </div>
      <div className="agora-video-shell replay-video-shell">
        <video
          ref={videoRef}
          key={playbackUrl}
          className="replay-video-player"
          src={playbackUrl}
          controls
          playsInline
          preload="auto"
          aria-label={`Recording: ${title}`}
          onLoadedData={() => setError('')}
          onError={() =>
            setError(
              'Could not load the replay video. Run ./scripts/start.sh (ensures demo.mp4 exists) and end the session again.',
            )
          }
        />
      </div>
      {error ? <p className="message error replay-error">{error}</p> : null}
      <p className="agora-status-text replay-note">
        This session has ended. POC replay uses a bundled demo video — your live camera feed is not
        recorded until Agora Cloud Recording is integrated. Live-only discounts no longer apply.
        Voice AI remains available for product questions and cart actions.
      </p>
    </div>
  );
}
