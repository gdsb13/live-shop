'use client';

import { useViewerPlayer } from '@/hooks/useViewerPlayer';

export function ViewerPlayerPanel({
  sessionId,
  sessionStatus,
}: {
  sessionId: string;
  sessionStatus: string;
}) {
  const { videoRef, state, statusText } = useViewerPlayer(sessionId, sessionStatus);

  if (sessionStatus === 'SCHEDULED') {
    return (
      <div className="agora-panel panel media-placeholder">
        <div className="media-placeholder-inner">
          <span className="media-placeholder-label">Session not started</span>
          <p>This live session is scheduled. Check back when it goes live.</p>
        </div>
      </div>
    );
  }

  if (sessionStatus === 'ENDED') {
    return (
      <div className="agora-panel panel media-placeholder">
        <div className="media-placeholder-inner">
          <span className="media-placeholder-label">Session ended</span>
          <p>Live video has ended. Recorded playback arrives in a later phase.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="agora-panel panel">
      <div className="agora-panel-header">
        <h3>Live video</h3>
        <span className={`agora-state-pill ${state}`}>
          {state === 'watching' ? 'LIVE' : state}
        </span>
      </div>
      <div className="agora-video-shell">
        <div ref={videoRef} className="agora-video-player" />
        {state !== 'watching' && (
          <div className="agora-video-overlay">
            <p>{statusText || 'Connecting…'}</p>
          </div>
        )}
      </div>
      {statusText && <p className="agora-status-text">{statusText}</p>}
    </div>
  );
}
