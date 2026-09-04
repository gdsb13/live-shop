'use client';

import { useViewerPlayer } from '@/hooks/useViewerPlayer';
import { ReplayPlayerPanel } from '@/components/agora/ReplayPlayerPanel';

export function ViewerPlayerPanel({
  sessionId,
  sessionStatus,
  recordingUrl,
  sessionTitle,
}: {
  sessionId: string;
  sessionStatus: string;
  recordingUrl?: string | null;
  sessionTitle?: string;
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
    if (recordingUrl) {
      return (
        <ReplayPlayerPanel
          sessionId={sessionId}
          recordingUrl={recordingUrl}
          title={sessionTitle || 'Recorded session'}
        />
      );
    }
    return (
      <div className="agora-panel panel media-placeholder">
        <div className="media-placeholder-inner">
          <span className="media-placeholder-label">Session ended</span>
          <p>Live video has ended. No recording is available for this session yet.</p>
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
