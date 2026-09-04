'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ProductCard } from '@/components/ProductCard';
import { useCart } from '@/components/CartProvider';
import { api } from '@/lib/api';
import { formatInr, productImageUrl } from '@/lib/format';
import type { LiveSession, Product } from '@/lib/types';

const ViewerPlayerPanel = dynamic(
  () => import('@/components/agora/ViewerPlayerPanel').then((m) => m.ViewerPlayerPanel),
  { ssr: false },
);

const LiveChatPanel = dynamic(
  () => import('@/components/agora/LiveChatPanel').then((m) => m.LiveChatPanel),
  { ssr: false },
);

export default function LiveSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const { refreshCart } = useCart();
  const [session, setSession] = useState<LiveSession | null>(null);
  const [featuredProductDetail, setFeaturedProductDetail] = useState<Product | null>(null);
  const [featuredLivePricing, setFeaturedLivePricing] = useState<{
    listPrice: number;
    discountEligible: boolean;
    discountPercent: number;
    discountAmount: number;
    effectivePrice: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [adding, setAdding] = useState(false);

  const loadSession = useCallback(async () => {
    const data = await api.getLiveSession(params.sessionId);
    setSession((prev) => {
      if (prev?.status === 'LIVE' && data.status !== 'LIVE') {
        refreshCart().catch(() => undefined);
      }
      return data;
    });
    if (data.featuredProduct) {
      const first = data.featuredProduct;
      const product = await api.getProduct(first.id);
      setFeaturedProductDetail(product);
      const firstVariant = product.variants.find((v) => v.inStock) || product.variants[0];
      if (data.status === 'LIVE' && firstVariant) {
        const priced = await api.getProduct(first.id, {
          variantId: firstVariant.id,
          originatingLiveSessionId: data.id,
        });
        setFeaturedLivePricing(priced.livePricing || null);
      } else {
        setFeaturedLivePricing(null);
      }
    } else {
      setFeaturedProductDetail(null);
      setFeaturedLivePricing(null);
    }
  }, [params.sessionId, refreshCart]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    loadSession()
      .catch((err: Error) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const interval = setInterval(() => {
      loadSession().catch(() => undefined);
    }, 10000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [loadSession]);

  const otherProducts = useMemo(() => {
    if (!session) return [];
    return session.products.filter((p) => p.id !== session.featuredProductId);
  }, [session]);

  const defaultVariantId = useMemo(() => {
    if (!featuredProductDetail) return '';
    const first = featuredProductDetail.variants.find((v) => v.inStock);
    return first?.id || featuredProductDetail.variants[0]?.id || '';
  }, [featuredProductDetail]);

  async function handleAddFeatured() {
    if (!session?.featuredProduct || !defaultVariantId) return;
    setAdding(true);
    setError('');
    setMessage('');
    try {
      await api.addToCart({
        productId: session.featuredProduct.id,
        variantId: defaultVariantId,
        quantity: 1,
        originatingLiveSessionId: session.status === 'LIVE' ? session.id : undefined,
      });
      await refreshCart();
      setMessage('Added featured product to cart.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add to cart');
    } finally {
      setAdding(false);
    }
  }

  if (loading && !session) {
    return (
      <main className="container page-section">
        <p>Loading session…</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="container page-section">
        <div className="message error">{error || 'Session not found'}</div>
        <Link href="/live">← Back to Live Shopping</Link>
      </main>
    );
  }

  return (
    <main className="live-view-page">
      <div className="container page-section">
        <p className="eyebrow">
          <Link href="/live">Live Shopping</Link> / {session.title}
        </p>

        <div className="live-view-grid">
          <div className="live-main-column">
            <ViewerPlayerPanel
              sessionId={session.id}
              sessionStatus={session.status}
              recordingUrl={session.recordingUrl}
              sessionTitle={session.title}
            />

            <div className="live-session-header panel">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <h1>{session.title}</h1>
                  <p className="live-host">Hosted by {session.hostName}</p>
                </div>
                <span className={`live-status-pill large ${session.status.toLowerCase()}`}>
                  {session.status === 'LIVE' && <span className="live-dot" />}
                  {session.status === 'ENDED' && session.recordingUrl ? 'RECORDED' : session.status}
                </span>
              </div>
              <p>{session.description}</p>
              {session.status === 'ENDED' && session.recordingUrl && (
                <p className="replay-session-note">
                  Watch Again — recorded session replay. Live-only discounts are not available; use Voice AI
                  to explore products and add to cart at regular prices.
                </p>
              )}
            </div>

            {session.featuredProduct && (
              <div className="featured-product-panel panel">
                <p className="eyebrow">Featured on air</p>
                <div className="featured-product-row">
                  <img
                    src={productImageUrl(session.featuredProduct.id, session.featuredProduct.image)}
                    alt={session.featuredProduct.name}
                  />
                  <div>
                    <h2>{session.featuredProduct.name}</h2>
                    <p className="brand">{session.featuredProduct.brand}</p>
                    {featuredLivePricing?.discountEligible ? (
                      <div className="live-price-breakdown">
                        <p className="live-price-line muted">
                          Original price: <span className="price-struck">{formatInr(featuredLivePricing.listPrice)}</span>
                        </p>
                        <p className="live-price-line live-discount-label">
                          LIVE {featuredLivePricing.discountPercent}%: -{formatInr(featuredLivePricing.discountAmount)}
                        </p>
                        <p className="featured-price">
                          Final: {formatInr(featuredLivePricing.effectivePrice)}
                        </p>
                      </div>
                    ) : (
                      <p className="featured-price">
                        {formatInr(session.featuredProduct.priceFrom)}
                      </p>
                    )}
                    {session.status === 'LIVE' && (
                      <p className="live-benefit-note">20% LIVE session discount applies at checkout for session products.</p>
                    )}
                    {session.status === 'ENDED' && (
                      <p className="replay-price-note">Regular price — live session discount has ended.</p>
                    )}
                    <div className="row" style={{ marginTop: 16 }}>
                      <Link
                        href={
                          session.status === 'LIVE'
                            ? `/products/${session.featuredProduct.id}?liveSession=${encodeURIComponent(session.id)}`
                            : `/products/${session.featuredProduct.id}`
                        }
                        className="button-secondary"
                      >
                        View product
                      </Link>
                      <button
                        className="button"
                        type="button"
                        onClick={handleAddFeatured}
                        disabled={adding || !defaultVariantId}
                      >
                        {adding ? 'Adding…' : session.status === 'ENDED' ? 'Add to cart (full price)' : 'Add to cart'}
                      </button>
                    </div>
                    {message && <div className="message success" style={{ marginTop: 12 }}>{message}</div>}
                    {error && <div className="message error" style={{ marginTop: 12 }}>{error}</div>}
                  </div>
                </div>
              </div>
            )}

            {otherProducts.length > 0 && (
              <div className="live-products-section">
                <h2>More in this session</h2>
                <div className="product-grid">
                  {otherProducts.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      liveSessionId={session.status === 'LIVE' ? session.id : undefined}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <aside className="live-side-column">
            <LiveChatPanel sessionId={session.id} sessionStatus={session.status} />
          </aside>
        </div>
      </div>
    </main>
  );
}
