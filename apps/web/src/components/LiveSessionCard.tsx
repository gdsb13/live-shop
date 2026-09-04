'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { LiveSession } from '@/lib/types';
import { formatSessionDate } from '@/lib/format';

function statusLabel(status: LiveSession['status'], recordingUrl: string | null) {
  if (status === 'LIVE') return 'Live now';
  if (status === 'SCHEDULED') return 'Upcoming';
  return recordingUrl ? 'Watch again' : 'Ended';
}

export function LiveSessionCard({ session }: { session: LiveSession }) {
  const [imgError, setImgError] = useState(false);
  const href = `/live/${session.id}`;
  const thumb =
    !imgError && session.thumbnail
      ? session.thumbnail
      : `https://picsum.photos/seed/${encodeURIComponent(session.id)}/800/450`;

  return (
    <Link href={href} className="live-session-card">
      <div className="live-session-thumb">
        <img src={thumb} alt="" onError={() => setImgError(true)} />
        <span className={`live-status-pill ${session.status.toLowerCase()}`}>
          {session.status === 'LIVE' && <span className="live-dot" />}
          {statusLabel(session.status, session.recordingUrl)}
        </span>
      </div>
      <div className="live-session-body">
        <p className="eyebrow">{session.hostName}</p>
        <h3>{session.title}</h3>
        <p className="live-session-meta">
          {session.status === 'SCHEDULED' && session.scheduledAt
            ? formatSessionDate(session.scheduledAt)
            : session.status === 'ENDED' && session.endedAt
              ? `Ended ${formatSessionDate(session.endedAt)}`
              : `${session.products.length} products`}
        </p>
        {session.featuredProduct && (
          <p className="live-featured-hint">
            Featured: {session.featuredProduct.name}
          </p>
        )}
      </div>
    </Link>
  );
}
