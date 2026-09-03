'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useCart } from '@/components/CartProvider';
import { api } from '@/lib/api';
import { formatInr } from '@/lib/format';
import type { PaymentOption, Product, Serviceability } from '@/lib/types';

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const { refreshCart } = useCart();
  const [product, setProduct] = useState<Product | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [pin, setPin] = useState('201014');
  const [serviceability, setServiceability] = useState<Serviceability | null>(null);
  const [paymentOptions, setPaymentOptions] = useState<PaymentOption[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([api.getProduct(params.id), api.getPaymentOptions()])
      .then(([productData, paymentData]) => {
        if (!active) return;
        setProduct(productData);
        const firstInStock = productData.variants.find((v) => v.inStock);
        setSelectedVariantId(firstInStock?.id || productData.variants[0]?.id || '');
        setPaymentOptions(paymentData.options);
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
  }, [params.id]);

  const selectedVariant = useMemo(
    () => product?.variants.find((v) => v.id === selectedVariantId) || null,
    [product, selectedVariantId],
  );

  async function handleServiceability() {
    setError('');
    setMessage('');
    try {
      const result = await api.checkServiceability(pin);
      setServiceability(result);
    } catch (err) {
      setServiceability(null);
      setError(err instanceof Error ? err.message : 'Serviceability check failed');
    }
  }

  async function handleAddToCart() {
    if (!product || !selectedVariant) return;
    setError('');
    setMessage('');
    try {
      await api.addToCart({
        productId: product.id,
        variantId: selectedVariant.id,
        quantity,
      });
      await refreshCart();
      setMessage('Added to cart.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add to cart');
    }
  }

  if (loading) {
    return (
      <main className="container page-section">
        <p>Loading product…</p>
      </main>
    );
  }

  if (!product) {
    return (
      <main className="container page-section">
        <div className="message error">{error || 'Product not found'}</div>
        <Link href="/">← Back to shop</Link>
      </main>
    );
  }

  return (
    <main className="container page-section">
      <p className="eyebrow">
        <Link href="/">Shop</Link> / {product.category}
      </p>
      <div className="pdp-grid">
        <div className="pdp-image panel">
          <img src={product.images[0]} alt={product.name} />
        </div>

        <div className="panel">
          <p className="eyebrow">{product.brand}</p>
          <h1>{product.name}</h1>
          <p className="rating">★ {product.rating.toFixed(1)}</p>
          <p>{product.description}</p>
          <h2 style={{ marginTop: 24 }}>
            {selectedVariant ? formatInr(selectedVariant.price) : formatInr(product.basePrice)}
          </h2>

          <h3>Select variant</h3>
          <div className="variant-list">
            {product.variants.map((variant) => (
              <button
                key={variant.id}
                type="button"
                className={`variant-option ${selectedVariantId === variant.id ? 'selected' : ''} ${!variant.inStock ? 'disabled' : ''}`}
                onClick={() => variant.inStock && setSelectedVariantId(variant.id)}
                disabled={!variant.inStock}
              >
                <span>{variant.name}</span>
                <span>{formatInr(variant.price)}</span>
              </button>
            ))}
          </div>

          <div className="row" style={{ marginTop: 16 }}>
            <label>
              Quantity{' '}
              <input
                className="quantity-input"
                type="number"
                min={1}
                max={10}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
            </label>
            <button
              className="button"
              type="button"
              onClick={handleAddToCart}
              disabled={!selectedVariant?.inStock}
            >
              Add to cart
            </button>
          </div>

          {message && <div className="message success" style={{ marginTop: 16 }}>{message}</div>}
          {error && <div className="message error" style={{ marginTop: 16 }}>{error}</div>}

          <h3 style={{ marginTop: 28 }}>Delivery serviceability</h3>
          <div className="row">
            <input
              className="text-input"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Indian PIN code"
            />
            <button className="button-secondary" type="button" onClick={handleServiceability}>
              Check PIN
            </button>
          </div>
          {serviceability && (
            <div className={`message ${serviceability.serviceable ? 'success' : 'error'}`} style={{ marginTop: 12 }}>
              {serviceability.message}
              {serviceability.estimatedDeliveryDate && (
                <div>Estimated delivery: {serviceability.estimatedDeliveryDate}</div>
              )}
            </div>
          )}

          <h3 style={{ marginTop: 28 }}>Payment options</h3>
          <ul className="feature-list">
            {paymentOptions.map((option) => (
              <li key={option.id}>
                <strong>{option.label}</strong> — {option.description}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 28 }}>
        <h2>Specifications</h2>
        <div className="summary-line">
          {Object.entries(product.specifications).map(([key, value]) => (
            <div key={key}>
              <strong>{key}</strong>
              <div>{value}</div>
            </div>
          ))}
        </div>
        <h3>Features</h3>
        <ul className="feature-list">
          {product.features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </div>
    </main>
  );
}
