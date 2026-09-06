'use client';

import { Mic, MicOff, Square, Video, VideoOff } from 'lucide-react';
import { useHostBroadcast } from '@/hooks/useHostBroadcast';

export function HostBroadcastPanel({
  sessionId,
  sessionStatus,
  onSessionChange,
}: {
  sessionId: string;
  sessionStatus: string;
  onSessionChange?: () => void | Promise<void>;
}) {
  const {
    videoRef,
    state,
    statusText,
    cameraOn,
    micOn,
    viewerCount,
    broadcastBlocked,
    goLive,
    toggleCamera,
    toggleMic,
    endBroadcast,
  } = useHostBroadcast(sessionId, sessionStatus, onSessionChange);

  const canGoLive =
    (sessionStatus === 'SCHEDULED' || sessionStatus === 'LIVE') &&
    state !== 'live' &&
    !broadcastBlocked;

  return (
    <div className="agora-panel panel">
      <div className="agora-panel-header">
        <h3>Host broadcast</h3>
        <div className="agora-panel-meta">
          {state === 'live' && (
            <span className="agora-viewer-count">
              {viewerCount} {viewerCount === 1 ? 'viewer' : 'viewers'}
            </span>
          )}
          <span className={`agora-state-pill ${state}`}>{state}</span>
        </div>
      </div>

      <div className="agora-video-shell">
        <div ref={videoRef} className="agora-video-player" />
        {state !== 'live' && (
          <div className="agora-video-overlay">
            <p>{statusText}</p>
          </div>
        )}
      </div>

      <p className="agora-status-text">{statusText}</p>

      {broadcastBlocked && <div className="message info">{statusText}</div>}

      <div className="row" style={{ marginTop: 12 }}>
        {canGoLive && (
          <button className="button" type="button" onClick={goLive}>
            Go live with camera + mic
          </button>
        )}
        {state === 'live' && (
          <>
            <button
              className={`button-secondary agora-icon-control agora-media-control ${!micOn ? 'is-off' : ''}`}
              type="button"
              onClick={toggleMic}
              aria-pressed={micOn}
              aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
              title={micOn ? 'Mute microphone' : 'Unmute microphone'}
            >
              {micOn ? <Mic size={20} aria-hidden="true" /> : <MicOff size={20} aria-hidden="true" />}
            </button>
            <button
              className={`button-secondary agora-icon-control agora-media-control ${!cameraOn ? 'is-off' : ''}`}
              type="button"
              onClick={toggleCamera}
              aria-pressed={cameraOn}
              aria-label={cameraOn ? 'Stop video' : 'Start video'}
              title={cameraOn ? 'Stop video' : 'Start video'}
            >
              {cameraOn ? (
                <Video size={20} aria-hidden="true" />
              ) : (
                <VideoOff size={20} aria-hidden="true" />
              )}
            </button>
            <button
              className="button-secondary agora-end-broadcast"
              type="button"
              onClick={endBroadcast}
              aria-label="End broadcast"
              title="End broadcast"
            >
              <Square size={16} aria-hidden="true" />
              End broadcast
            </button>
          </>
        )}
      </div>
    </div>
  );
}
