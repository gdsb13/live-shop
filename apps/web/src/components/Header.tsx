'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useCart } from '@/components/CartProvider';
import { api } from '@/lib/api';

export function Header() {
  const pathname = usePathname();
  const { cart } = useCart();
  const count = cart?.itemCount ?? 0;
  const [liveCount, setLiveCount] = useState(0);
  const isHostConsole = pathname === '/host' || pathname.startsWith('/host/');

  useEffect(() => {
    api
      .getLiveSessions()
      .then((data) => setLiveCount(data.live.length))
      .catch(() => setLiveCount(0));
  }, []);

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark">LS</span>
          <span>
            <strong>Live Shop</strong>
            <small>Premium multi-category store</small>
          </span>
        </Link>
        <nav className="header-nav">
          <Link href="/">Shop</Link>
          <Link href="/live" className="live-nav-link">
            Live Shopping
            {liveCount > 0 && (
              <span className="live-nav-badge">
                <span className="live-dot" />
                {liveCount} live
              </span>
            )}
          </Link>
          {!isHostConsole && (
            <Link href="/cart" className="cart-link">
              Cart
              {count > 0 && <span className="cart-badge">{count}</span>}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
