'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ProductSummary } from '@/lib/types';
import { formatInr, productImageUrl } from '@/lib/format';

export function ProductCard({ product }: { product: ProductSummary }) {
  const [imgSrc, setImgSrc] = useState(productImageUrl(product.id, product.image));

  return (
    <Link href={`/products/${product.id}`} className="product-card">
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
          <strong>{formatInr(product.priceFrom)}</strong>
          <span className="rating">★ {product.rating.toFixed(1)}</span>
        </div>
      </div>
    </Link>
  );
}
