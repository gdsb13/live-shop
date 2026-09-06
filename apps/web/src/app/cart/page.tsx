'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useCart } from '@/components/CartProvider';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { formatInr } from '@/lib/format';

export default function CartPage() {
  const { cart, refreshCart } = useCart();
  const { showToast } = useToast();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [updatingItemId, setUpdatingItemId] = useState('');

  async function updateQuantity(itemId: string, quantity: number, productName?: string) {
    setError('');
    setMessage('');
    setUpdatingItemId(itemId);
    try {
      await api.updateCartItem(itemId, quantity);
      await refreshCart();
      if (productName) {
        showToast(`Updated ${productName} quantity to ${quantity}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update item');
    } finally {
      setUpdatingItemId('');
    }
  }

  async function adjustQuantity(itemId: string, currentQuantity: number, delta: number) {
    const nextQuantity = currentQuantity + delta;
    if (nextQuantity <= 0) {
      await removeItem(itemId);
      return;
    }
    if (nextQuantity > 10) return;
    await updateQuantity(itemId, nextQuantity, cart?.items.find((item) => item.id === itemId)?.productName);
  }

  async function removeItem(itemId: string) {
    setError('');
    setMessage('');
    setUpdatingItemId(itemId);
    try {
      await api.removeCartItem(itemId);
      await refreshCart();
      setMessage('Item removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove item');
    } finally {
      setUpdatingItemId('');
    }
  }

  if (!cart) {
    return (
      <main className="container page-section">
        <p>Loading cart…</p>
      </main>
    );
  }

  return (
    <main className="container page-section">
      <h1>Your cart</h1>
      {cart.items.length === 0 ? (
        <div className="empty-state panel">
          <p>Your cart is empty.</p>
          <Link className="button" href="/">Continue shopping</Link>
        </div>
      ) : (
        <div className="cart-grid">
          <div className="panel">
            {cart.items.map((item) => (
              <div className="cart-item" key={item.id}>
                <img src={item.image} alt={item.productName} />
                <div className="cart-item-main">
                  <strong>{item.productName}</strong>
                  <div className="brand">{item.brand}</div>
                  <div>{item.variantName}</div>
                  <div className="row" style={{ marginTop: 12 }}>
                    <div className="qty-stepper">
                      <button
                        className="qty-stepper__btn"
                        type="button"
                        aria-label={`Decrease quantity of ${item.productName}`}
                        disabled={updatingItemId === item.id}
                        onClick={() => adjustQuantity(item.id, item.quantity, -1)}
                      >
                        −
                      </button>
                      <span className="qty-stepper__value" aria-live="polite">
                        {item.quantity}
                      </span>
                      <button
                        className="qty-stepper__btn"
                        type="button"
                        aria-label={`Increase quantity of ${item.productName}`}
                        disabled={updatingItemId === item.id || item.quantity >= 10}
                        onClick={() => adjustQuantity(item.id, item.quantity, 1)}
                      >
                        +
                      </button>
                    </div>
                    <button className="button-secondary" type="button" onClick={() => removeItem(item.id)}>
                      Remove
                    </button>
                  </div>
                </div>
                <div className="cart-item-pricing">
                  {item.discountEligible ? (
                    <>
                      <div className="cart-price-line muted">
                        Original: {formatInr(item.listPrice ?? item.unitPrice)} each
                      </div>
                      <div className="cart-price-line live-discount-label">
                        LIVE {item.discountPercent}%: -{formatInr(item.discountAmount || 0)}
                      </div>
                      <strong>Final: {formatInr(item.lineTotal)}</strong>
                    </>
                  ) : (
                    <>
                      <div>{formatInr(item.unitPrice)} each</div>
                      <strong>{formatInr(item.lineTotal)}</strong>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="panel">
            <h2>Order summary</h2>
            <div className="summary-line">
              <span>Items</span>
              <span>{cart.itemCount}</span>
            </div>
            <div className="summary-line">
              <span>Subtotal</span>
              <strong>{formatInr(cart.subtotal)}</strong>
            </div>
            {(cart.discountTotal || 0) > 0 && (
              <div className="summary-line live-discount-label">
                <span>LIVE savings</span>
                <span>-{formatInr(cart.discountTotal || 0)}</span>
              </div>
            )}
            {message && <div className="message success">{message}</div>}
            {error && <div className="message error">{error}</div>}
            <Link className="button" href="/checkout" style={{ marginTop: 18, width: '100%' }}>
              Proceed to checkout
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
