'use client';

import { useLiveChat } from '@/hooks/useLiveChat';
import { formatSessionDate } from '@/lib/format';

export function LiveChatPanel({
  sessionId,
  sessionStatus,
  isHost = false,
}: {
  sessionId: string;
  sessionStatus: string;
  isHost?: boolean;
}) {
  const {
    state,
    notice,
    error,
    displayName,
    nameDraft,
    chatJoined,
    canJoinChat,
    canSend,
    draft,
    messages,
    setNameDraft,
    setDraft,
    joinChat,
    sendMessage,
  } = useLiveChat(sessionId, sessionStatus, isHost);

  if (sessionStatus !== 'LIVE') {
    return (
      <div className="chat-placeholder panel">
        <h3>Live chat</h3>
        <p>
          {sessionStatus === 'SCHEDULED'
            ? 'Chat opens when the session goes live.'
            : 'Chat is closed for ended sessions.'}
        </p>
      </div>
    );
  }

  return (
    <div className="live-chat panel">
      <div className="live-chat-header">
        <h3>Live chat</h3>
        <span className={`agora-state-pill ${state}`}>{state}</span>
      </div>

      {notice && <div className="message info">{notice}</div>}

      {!chatJoined && (
        <div className="live-chat-name">
          <label className="live-chat-name-label" htmlFor={`chat-name-${sessionId}`}>
            Display name
          </label>
          <input
            id={`chat-name-${sessionId}`}
            className="text-input"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder={isHost ? 'Host' : 'Your name'}
            disabled={state !== 'connected'}
          />
          <button
            className="button"
            type="button"
            onClick={joinChat}
            disabled={!canJoinChat}
            style={{ marginTop: 10 }}
          >
            Join chat
          </button>
        </div>
      )}

      {chatJoined && (
        <p className="live-chat-joined-as">
          Chatting as <strong>{displayName}</strong>
        </p>
      )}

      {error && <div className="message error">{error}</div>}

      <div className="live-chat-messages">
        {messages.length === 0 && chatJoined && (
          <p className="live-chat-empty">Say hello in the chat.</p>
        )}
        {messages.map((message) => (
          <div key={message.id} className="live-chat-message">
            <strong>{message.sender}</strong>
            <span className="live-chat-time">{formatSessionDate(message.ts)}</span>
            <p>{message.text}</p>
          </div>
        ))}
      </div>

      <form
        className="live-chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage();
        }}
      >
        <input
          className="text-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={chatJoined ? 'Type a message…' : 'Join chat to send messages'}
          disabled={!canSend}
        />
        <button className="button" type="submit" disabled={!canSend || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
