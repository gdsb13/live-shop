'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LiveSessionCard } from '@/components/LiveSessionCard';
import { api } from '@/lib/api';
import type { LiveSessionList } from '@/lib/types';

export default function LiveDiscoveryPage() {
  const [data, setData] = useState<LiveSessionList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    const load = () => {
      api
        .getLiveSessions()
        .then((sessions) => {
          if (active) setData(sessions);
        })
        .catch((err: Error) => {
          if (active) setError(err.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    };

    load();
    const interval = setInterval(load, 5000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <main>
      <section className="page-hero">
        <div className="container">
          <p className="eyebrow">Live Shopping</p>
          <h1>Watch, discover and shop in real time.</h1>
          <p className="page-hero-lead">
            Join live sessions hosted by our sellers, see products featured on air,
            and add to cart using the same checkout you already know.
          </p>
          {data && data.live.length > 0 && (
            <Link href={`/live/${data.live[0].id}`} className="button live-hero-cta">
              <span className="live-dot" />
              Join live session
            </Link>
          )}
        </div>
      </section>

      <section className="container page-section">
        {error && <div className="message error">{error}</div>}
        {loading && <p>Loading live sessions…</p>}

        {!loading && data && (
          <>
            <div className="live-section">
              <div className="section-heading">
                <h2>Live now</h2>
                <p>Sessions broadcasting right now</p>
              </div>
              {data.live.length === 0 ? (
                <div className="empty-state panel">No sessions are live at the moment.</div>
              ) : (
                <div className="live-session-grid">
                  {data.live.map((session) => (
                    <LiveSessionCard key={session.id} session={session} />
                  ))}
                </div>
              )}
            </div>

            <div className="live-section">
              <div className="section-heading">
                <h2>Upcoming</h2>
                <p>Scheduled sessions you can plan for</p>
              </div>
              {data.scheduled.length === 0 ? (
                <div className="empty-state panel">No upcoming sessions scheduled.</div>
              ) : (
                <div className="live-session-grid">
                  {data.scheduled.map((session) => (
                    <LiveSessionCard key={session.id} session={session} />
                  ))}
                </div>
              )}
            </div>

            <div className="live-section">
              <div className="section-heading">
                <h2>Watch again</h2>
                <p>Recorded sessions you can replay anytime</p>
              </div>
              {data.ended.length === 0 ? (
                <div className="empty-state panel">No recorded sessions yet.</div>
              ) : (
                <div className="live-session-grid">
                  {data.ended.map((session) => (
                    <LiveSessionCard key={session.id} session={session} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
