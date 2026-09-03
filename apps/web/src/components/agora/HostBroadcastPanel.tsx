'use client';

import { useHostBroadcast } from '@/hooks/useHostBroadcast';

export function HostBroadcastPanel({
  sessionId,
  sessionStatus,
}: {
  sessionId: string;
  sessionStatus: string;
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
    stopBroadcast,
  } = useHostBroadcast(sessionId, sessionStatus);

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
        {sessionStatus === 'LIVE' && state !== 'live' && !broadcastBlocked && (
          <button className="button" type="button" onClick={goLive}>
            Go live with camera + mic
          </button>
        )}
        {state === 'live' && (
          <>
            <button
              className={`button-secondary agora-media-control ${!micOn ? 'is-off' : ''}`}
              type="button"
              onClick={toggleMic}
              aria-pressed={micOn}
            >
              {micOn ? 'Mute' : 'Unmute'}
            </button>
            <button
              className={`button-secondary agora-media-control ${!cameraOn ? 'is-off' : ''}`}
              type="button"
              onClick={toggleCamera}
              aria-pressed={cameraOn}
            >
              {cameraOn ? 'Stop video' : 'Start video'}
            </button>
            <button className="button-secondary" type="button" onClick={stopBroadcast}>
              End
            </button>
          </>
        )}
      </div>
    </div>
  );
}
