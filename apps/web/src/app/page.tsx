'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ProductCard } from '@/components/ProductCard';
import { api } from '@/lib/api';
import type { LiveSession, ProductSummary } from '@/lib/types';

export default function HomePage() {
  const [categories, setCategories] = useState<string[]>([]);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    Promise.all([
      api.getProducts({
        category: category || undefined,
        search: search || undefined,
      }),
      api.getLiveSessions(),
    ])
      .then(([productData, liveData]) => {
        if (!active) return;
        setCategories(productData.categories);
        setProducts(productData.products);
        setLiveSessions(liveData.live);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [category, search]);

  return (
    <main>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Premium Indian ecommerce</p>
            <h1>Shop curated products — and join live sessions when sellers go on air.</h1>
            <p>
              Browse electronics, fashion, beauty, home and lifestyle. Add to cart,
              check PIN serviceability, and checkout — with live shopping built in
              from the ground up.
            </p>
            <div className="row" style={{ marginTop: 24 }}>
              <Link href="/live" className="button live-hero-cta">
                {liveSessions.length > 0 ? (
                  <>
                    <span className="live-dot" />
                    {liveSessions.length} session{liveSessions.length > 1 ? 's' : ''} live now
                  </>
                ) : (
                  'Explore Live Shopping'
                )}
              </Link>
              <Link href="/live" className="button-secondary">
                View schedule
              </Link>
            </div>
          </div>
          <div className="hero-panel">
            {liveSessions[0] ? (
              <Link href={`/live/${liveSessions[0].id}`} className="hero-live-spotlight">
                <span className="live-status-pill live">
                  <span className="live-dot" />
                  Live now
                </span>
                <strong>{liveSessions[0].title}</strong>
                <span>with {liveSessions[0].hostName}</span>
              </Link>
            ) : (
              <div className="stat">
                <strong>Live Shopping</strong>
                <span>Check upcoming sessions</span>
              </div>
            )}
            <div className="stat">
              <strong>{categories.length || 5}</strong>
              <span>Categories</span>
            </div>
            <div className="stat">
              <strong>{products.length}</strong>
              <span>Products shown</span>
            </div>
          </div>
        </div>
      </section>

      <section className="container page-section">
        <div className="toolbar">
          <input
            className="search-input"
            placeholder="Search products, brands, features…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="select-input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div className="category-pills">
          <button
            type="button"
            className={`pill ${category === '' ? 'active' : ''}`}
            onClick={() => setCategory('')}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`pill ${category === cat ? 'active' : ''}`}
              onClick={() => setCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        {error && <div className="message error">{error}</div>}
        {loading && <p>Loading products…</p>}
        {!loading && products.length === 0 && (
          <div className="empty-state">No products match your filters.</div>
        )}
        <div className="product-grid">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>
    </main>
  );
}
