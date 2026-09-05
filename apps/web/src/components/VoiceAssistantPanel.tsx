'use client';

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
  muted: 'Muted',
  error: 'Error',
};

function resolveDisplayState(
  state: VoiceAssistantState,
  micMuted: boolean,
  sessionActive: boolean,
): VoiceDisplayState {
  if (state === 'error' || state === 'connecting' || state === 'speaking' || state === 'thinking') {
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
    toggleVoiceMicMuted,
    micMuted,
    setOpen,
  } = useVoiceAssistant();

  const sessionActive = open && state !== 'idle' && state !== 'error';
  const displayState = resolveDisplayState(state, micMuted, sessionActive);

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
        <button type="button" className="voice-ai-panel__close" onClick={() => stopAssistant()}>
          Stop
        </button>
      </header>

      <div className="voice-ai-panel__status">
        <div
          className={`voice-ai-orb voice-ai-orb--${displayState}`}
          role="status"
          aria-label={STATE_LABELS[displayState]}
        />
      </div>

      {notice ? <p className="voice-ai-panel__notice">{notice}</p> : null}
      {error ? <p className="voice-ai-panel__error">{error}</p> : null}

      <div className="voice-ai-panel__transcript">
        {transcripts.length === 0 ? (
          <p className="voice-ai-panel__placeholder">Your conversation will appear here.</p>
        ) : (
          transcripts.map((line, index) => (
            <p
              key={`${line.role}-${line.ts}-${index}`}
              className={`voice-ai-line voice-ai-line--${line.role}${line.filler ? ' voice-ai-line--filler' : ''}`}
            >
              <span>{line.role === 'user' ? 'You' : 'Assistant'}</span>
              {line.text}
            </p>
          ))
        )}
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
    </aside>
  );
}
