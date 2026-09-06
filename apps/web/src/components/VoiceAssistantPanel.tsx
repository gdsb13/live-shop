'use client';

import { useEffect, useRef } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { useCart } from '@/components/CartProvider';
import { useVoiceAssistant } from '@/hooks/useVoiceAssistant';
import type { VoiceAssistantState } from '@/lib/voice/types';

type VoiceDisplayState = VoiceAssistantState | 'muted';

const STATE_LABELS: Record<VoiceDisplayState, string> = {
  idle: 'Ready',
  connecting: 'Connecting…',
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking',
  ended: 'Chat ended',
  muted: 'Muted',
  error: 'Error',
};

const NEAR_BOTTOM_THRESHOLD_PX = 80;

function resolveDisplayState(
  state: VoiceAssistantState,
  micMuted: boolean,
  sessionActive: boolean,
): VoiceDisplayState {
  if (
    state === 'error' ||
    state === 'connecting' ||
    state === 'speaking' ||
    state === 'thinking' ||
    state === 'ended'
  ) {
    return state;
  }
  if (micMuted && sessionActive) return 'muted';
  return state;
}

export function VoiceAssistantPanel() {
  const { refreshCart, applyCart } = useCart();
  const {
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
  } = useVoiceAssistant();

  const transcriptRef = useRef<HTMLDivElement>(null);
  const transcriptBottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  const sessionActive =
    open && state !== 'idle' && state !== 'error' && state !== 'ended';
  const displayState = resolveDisplayState(state, micMuted, sessionActive);
  const orbState = displayState === 'ended' ? 'idle' : displayState;

  useEffect(() => {
    const container = transcriptRef.current;
    if (!container) return undefined;

    const onScroll = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      userScrolledUpRef.current = distanceFromBottom > NEAR_BOTTOM_THRESHOLD_PX;
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (userScrolledUpRef.current) return;
    transcriptBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [transcripts]);

  if (!open && state === 'idle') {
    return (
      <button
        type="button"
        className="voice-ai-fab"
        onClick={() => startAssistant(refreshCart, applyCart)}
        aria-label="Ask AI shopping assistant"
      >
        Ask AI
      </button>
    );
  }

  return (
    <aside className="voice-ai-panel" aria-live="polite">
      <header className="voice-ai-panel__header">
        <div>
          <strong>Voice Assistant</strong>
          <span className="voice-ai-panel__state">{STATE_LABELS[displayState]}</span>
        </div>
        {sessionActive ? (
          <button type="button" className="voice-ai-panel__close" onClick={() => stopAssistant()}>
            Stop
          </button>
        ) : state === 'ended' ? (
          <button type="button" className="voice-ai-panel__close" onClick={() => dismissPanel()}>
            Close
          </button>
        ) : null}
      </header>

      <div className="voice-ai-panel__status">
        <div
          className={`voice-ai-orb voice-ai-orb--${orbState}`}
          role="status"
          aria-label={STATE_LABELS[displayState]}
        />
      </div>

      {notice ? <p className="voice-ai-panel__notice">{notice}</p> : null}
      {error ? <p className="voice-ai-panel__error">{error}</p> : null}

      <div ref={transcriptRef} className="voice-ai-panel__transcript">
        {transcripts.length === 0 ? (
          <p className="voice-ai-panel__placeholder">Your conversation will appear here.</p>
        ) : (
          transcripts.map((line, index) => (
            <p
              key={
                line.lineKey
                  ? `${line.lineKey}@${index}`
                  : `${line.role}:${line.turnId ?? 'na'}:${line.streamId ?? 0}@${index}`
              }
              className={`voice-ai-line voice-ai-line--${line.role}${line.filler ? ' voice-ai-line--filler' : ''}`}
            >
              <span>{line.role === 'user' ? 'You' : 'Assistant'}</span>
              {line.text}
            </p>
          ))
        )}
        <div ref={transcriptBottomRef} aria-hidden="true" />
      </div>

      {sessionActive ? (
        <div className="voice-ai-panel__controls">
          <button
            type="button"
            className={`voice-ai-panel__mic ${micMuted ? 'is-muted' : ''}`}
            onClick={() => toggleVoiceMicMuted()}
            aria-pressed={!micMuted}
            aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
            title={micMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {micMuted ? <MicOff size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}
            {micMuted ? 'Unmute mic' : 'Mute mic'}
          </button>
        </div>
      ) : null}

      <div ref={audioAnchorRef} className="voice-ai-panel__audio" aria-hidden="true" />

      {state === 'error' ? (
        <button
          type="button"
          className="voice-ai-panel__retry"
          onClick={() => {
            setOpen(false);
            startAssistant(refreshCart, applyCart);
          }}
        >
          Try again
        </button>
      ) : null}

      {state === 'ended' ? (
        <button
          type="button"
          className="voice-ai-panel__retry"
          onClick={() => startAssistant(refreshCart, applyCart)}
        >
          Start again
        </button>
      ) : null}
    </aside>
  );
}
