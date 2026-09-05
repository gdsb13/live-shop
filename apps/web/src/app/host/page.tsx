'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { formatSessionDate } from '@/lib/format';
import type { LiveSession } from '@/lib/types';

const HostBroadcastPanel = dynamic(
  () => import('@/components/agora/HostBroadcastPanel').then((m) => m.HostBroadcastPanel),
  { ssr: false },
);

const LiveChatPanel = dynamic(
  () => import('@/components/agora/LiveChatPanel').then((m) => m.LiveChatPanel),
  { ssr: false },
);

export default function HostPage() {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');

  const loadSessions = useCallback(async () => {
    const data = await api.getLiveSessions();
    setSessions(data.sessions);
  }, []);

  useEffect(() => {
    loadSessions()
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [loadSessions]);

  async function runAction(
    sessionId: string,
    action: () => Promise<LiveSession>,
    successMsg: string,
  ) {
    setBusyId(sessionId);
    setError('');
    setMessage('');
    try {
      await action();
      await loadSessions();
      setMessage(successMsg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyId('');
    }
  }

  return (
    <main className="container page-section">
      <p className="eyebrow">Prototype host tools</p>
      <h1>Host console</h1>
      <p className="host-disclaimer message info">
        Host identity and authorization are mocked for this prototype. Production
        requires authenticated seller/host access with role-based permissions.
        Agora host tokens are only issued for host-* user ids from this console.
      </p>

      <div className="row" style={{ margin: '20px 0' }}>
        <Link
          href="/live"
          className="button-secondary"
          target="_blank"
          rel="noopener noreferrer"
        >
          View shopper Live Shopping page
        </Link>
        <button className="button-secondary" type="button" onClick={() => loadSessions()}>
          Refresh
        </button>
      </div>

      {message && <div className="message success">{message}</div>}
      {error && <div className="message error">{error}</div>}
      {loading && <p>Loading sessions…</p>}

      <div className="host-session-list">
        {sessions.map((session) => (
          <div key={session.id} className="host-session-card panel">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2>{session.title}</h2>
                <p className="brand">{session.hostName}</p>
                <p>
                  <span className={`live-status-pill ${session.status.toLowerCase()}`}>
                    {session.status}
                  </span>
                </p>
                <p className="live-session-meta">
                  Scheduled: {formatSessionDate(session.scheduledAt)}
                </p>
                {session.startedAt && (
                  <p className="live-session-meta">Started: {formatSessionDate(session.startedAt)}</p>
                )}
                {session.endedAt && (
                  <p className="live-session-meta">Ended: {formatSessionDate(session.endedAt)}</p>
                )}
              </div>
              <Link
                href={`/live/${session.id}`}
                className="button-secondary"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open viewer page
              </Link>
            </div>

            {(session.status === 'SCHEDULED' || session.status === 'LIVE') && (
              <>
                <HostBroadcastPanel
                  sessionId={session.id}
                  sessionStatus={session.status}
                  onSessionChange={loadSessions}
                />
                {session.status === 'LIVE' && (
                  <LiveChatPanel sessionId={session.id} sessionStatus={session.status} isHost />
                )}
              </>
            )}

            {session.status === 'LIVE' && session.products.length > 0 && (
              <div className="host-featured">
                <h3>Feature a product</h3>
                <div className="host-product-picks">
                  {session.products.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className={`host-product-pick ${session.featuredProductId === product.id ? 'selected' : ''}`}
                      disabled={busyId === session.id}
                      onClick={() =>
                        runAction(
                          session.id,
                          () => api.setFeaturedProduct(session.id, product.id),
                          `Featured "${product.name}"`,
                        )
                      }
                    >
                      {product.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
