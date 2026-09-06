'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useCart } from '@/components/CartProvider';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { formatInr } from '@/lib/format';
import type { Order, PaymentOption } from '@/lib/types';

export default function CheckoutPage() {
  const { cart, refreshCart } = useCart();
  const { showToast } = useToast();
  const [paymentOptions, setPaymentOptions] = useState<PaymentOption[]>([]);
  const [paymentMethod, setPaymentMethod] = useState('upi');
  const [deliveryPin, setDeliveryPin] = useState('201014');
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.getPaymentOptions().then((data) => {
      setPaymentOptions(data.options);
      setPaymentMethod(data.options[0]?.id || 'upi');
    });
  }, []);

  useEffect(() => {
    refreshCart();
  }, [refreshCart]);

  async function handleCheckout() {
    setError('');
    setSubmitting(true);
    try {
      await refreshCart();
      const result = await api.checkout({ paymentMethod, deliveryPin });
      setOrder(result);
      showToast(`Order placed successfully — ${result.orderId}`);
      await refreshCart();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (!cart) {
    return (
      <main className="container page-section">
        <p>Loading checkout…</p>
      </main>
    );
  }

  if (order) {
    return (
      <main className="container page-section">
        <div className="panel">
          <p className="eyebrow">Mock order confirmed</p>
          <h1>Thank you for your order</h1>
          <p>{order.message}</p>
          <div className="summary-line">
            <span>Order ID</span>
            <strong>{order.orderId}</strong>
          </div>
          <div className="summary-line">
            <span>Payment method</span>
            <strong>{order.paymentMethod.toUpperCase()}</strong>
          </div>
          <div className="summary-line">
            <span>Total paid (mock)</span>
            <strong>{formatInr(order.subtotal)}</strong>
          </div>
          <Link className="button" href="/" style={{ marginTop: 18 }}>
            Continue shopping
          </Link>
        </div>
      </main>
    );
  }

  if (cart.items.length === 0) {
    return (
      <main className="container page-section">
        <div className="empty-state panel">
          <p>Your cart is empty. Add products before checkout.</p>
          <Link className="button" href="/">Back to shop</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="container page-section">
      <h1>Checkout</h1>
      <div className="checkout-grid">
        <div className="panel">
          <h2>Delivery PIN</h2>
          <input
            className="text-input"
            value={deliveryPin}
            onChange={(e) => setDeliveryPin(e.target.value)}
            placeholder="Indian PIN code"
          />

          <h2 style={{ marginTop: 24 }}>Payment method</h2>
          {paymentOptions.map((option) => (
            <label
              key={option.id}
              className={`payment-option ${paymentMethod === option.id ? 'selected' : ''}`}
            >
              <input
                type="radio"
                name="payment"
                value={option.id}
                checked={paymentMethod === option.id}
                onChange={() => setPaymentMethod(option.id)}
                style={{ marginRight: 10 }}
              />
              <strong>{option.label}</strong>
              <div className="brand">{option.description}</div>
            </label>
          ))}
        </div>

        <div className="panel">
          <h2>Order summary</h2>
          {cart.items.map((item) => (
            <div className="summary-line" key={item.id}>
              <span>
                {item.productName} × {item.quantity}
              </span>
              <strong>{formatInr(item.lineTotal)}</strong>
            </div>
          ))}
          <div className="summary-line">
            <span>Subtotal</span>
            <strong>{formatInr(cart.subtotal)}</strong>
          </div>
          {error && <div className="message error">{error}</div>}
          <button
            className="button"
            type="button"
            onClick={handleCheckout}
            disabled={submitting}
            style={{ marginTop: 18, width: '100%' }}
          >
            {submitting ? 'Placing order…' : 'Place mock order'}
          </button>
        </div>
      </div>
    </main>
  );
}
