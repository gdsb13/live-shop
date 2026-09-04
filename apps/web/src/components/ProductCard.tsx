'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ProductSummary } from '@/lib/types';
import { formatInr, productImageUrl } from '@/lib/format';

export function ProductCard({
  product,
  liveSessionId,
}: {
  product: ProductSummary;
  liveSessionId?: string;
}) {
  const [imgSrc, setImgSrc] = useState(productImageUrl(product.id, product.image));
  const href = liveSessionId
    ? `/products/${product.id}?liveSession=${encodeURIComponent(liveSessionId)}`
    : `/products/${product.id}`;

  return (
    <Link href={href} className="product-card">
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
  );
}
