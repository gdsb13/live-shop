'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useCart } from '@/components/CartProvider';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import type { ProductSummary } from '@/lib/types';
import { formatInr, productImageUrl } from '@/lib/format';

export function ProductCard({
  product,
  liveSessionId,
  showAddToCart = false,
}: {
  product: ProductSummary;
  liveSessionId?: string;
  showAddToCart?: boolean;
}) {
  const { refreshCart } = useCart();
  const { showToast } = useToast();
  const [imgSrc, setImgSrc] = useState(productImageUrl(product.id, product.image));
  const [adding, setAdding] = useState(false);
  const [addMessage, setAddMessage] = useState('');
  const href = liveSessionId
    ? `/products/${product.id}?liveSession=${encodeURIComponent(liveSessionId)}`
    : `/products/${product.id}`;

  async function handleAddToCart(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!product.inStock || adding) return;

    setAdding(true);
    setAddMessage('');
    try {
      const detail = await api.getProduct(product.id);
      const variant = detail.variants.find((entry) => entry.inStock) || detail.variants[0];
      if (!variant) throw new Error('No variant available');
      await api.addToCart({
        productId: product.id,
        variantId: variant.id,
        quantity: 1,
      });
      await refreshCart();
      showToast(`Added ${product.name} to cart`);
      setAddMessage('Added');
      window.setTimeout(() => setAddMessage(''), 1800);
    } catch (err) {
      setAddMessage(err instanceof Error ? err.message : 'Could not add');
    } finally {
      setAdding(false);
    }
  }

  return (
    <article className="product-card">
      <Link href={href} className="product-card-link">
        <div className="product-image-wrap">
          <img
            src={imgSrc}
            alt={product.name}
            onError={() =>
              setImgSrc(`https://picsum.photos/seed/${encodeURIComponent(product.id)}/800/600`)
            }
          />
          {!product.inStock && <span className="badge muted">Out of stock</span>}
        </div>
        <div className="product-card-body">
          <p className="eyebrow">{product.category}</p>
          <h3>{product.name}</h3>
          <p className="brand">{product.brand}</p>
          <div className="product-card-footer">
            {product.discountEligible && product.effectivePrice !== undefined ? (
              <>
                <strong>{formatInr(product.effectivePrice)}</strong>
                <span className="live-discount-label">LIVE {product.discountPercent}%</span>
              </>
            ) : (
              <strong>{formatInr(product.priceFrom)}</strong>
            )}
            <span className="rating">★ {product.rating.toFixed(1)}</span>
          </div>
        </div>
      </Link>
      {showAddToCart && product.inStock ? (
        <div className="product-card-actions">
          <button
            type="button"
            className="button-secondary product-card-add"
            disabled={adding}
            onClick={handleAddToCart}
          >
            {adding ? 'Adding…' : 'Add to cart'}
          </button>
          {addMessage ? <span className="product-card-add-note">{addMessage}</span> : null}
        </div>
      ) : null}
    </article>
  );
}
