'use client';

import { useCart } from '@/components/CartProvider';
import { useVoiceAssistant } from '@/hooks/useVoiceAssistant';

const STATE_LABELS: Record<string, string> = {
  idle: 'Ready',
  connecting: 'Connecting…',
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking',
  error: 'Error',
};

export function VoiceAssistantPanel() {
  const { refreshCart, applyCart } = useCart();
  const { open, state, error, notice, transcripts, audioAnchorRef, startAssistant, stopAssistant, setOpen } =
    useVoiceAssistant();

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
          <span className="voice-ai-panel__state">{STATE_LABELS[state] || state}</span>
        </div>
        <button type="button" className="voice-ai-panel__close" onClick={() => stopAssistant()}>
          Stop
        </button>
      </header>

      {notice ? <p className="voice-ai-panel__notice">{notice}</p> : null}
      {error ? <p className="voice-ai-panel__error">{error}</p> : null}

      <div className="voice-ai-panel__transcript">
        {transcripts.length === 0 ? (
          <p className="voice-ai-panel__placeholder">Your conversation will appear here.</p>
        ) : (
          transcripts.map((line, index) => (
            <p key={`${line.ts}-${index}`} className={`voice-ai-line voice-ai-line--${line.role}`}>
              <span>{line.role === 'user' ? 'You' : 'Assistant'}</span>
              {line.text}
            </p>
          ))
        )}
      </div>

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
