'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useCart } from '@/components/CartProvider';
import { api } from '@/lib/api';
import { formatInr } from '@/lib/format';

export default function CartPage() {
  const { cart, refreshCart } = useCart();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function updateQuantity(itemId: string, quantity: number) {
    setError('');
    setMessage('');
    try {
      await api.updateCartItem(itemId, quantity);
      await refreshCart();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update item');
    }
  }

  async function removeItem(itemId: string) {
    setError('');
    setMessage('');
    try {
      await api.removeCartItem(itemId);
      await refreshCart();
      setMessage('Item removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove item');
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
                    <input
                      className="quantity-input"
                      type="number"
                      min={1}
                      max={10}
                      value={item.quantity}
                      onChange={(e) => updateQuantity(item.id, Number(e.target.value))}
                    />
                    <button className="button-secondary" type="button" onClick={() => removeItem(item.id)}>
                      Remove
                    </button>
                  </div>
                </div>
                <div>
                  <div>{formatInr(item.unitPrice)} each</div>
                  <strong>{formatInr(item.lineTotal)}</strong>
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
