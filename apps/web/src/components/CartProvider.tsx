'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from '@/lib/api';
import type { Cart } from '@/lib/types';

type CartContextValue = {
  cart: Cart | null;
  loading: boolean;
  refreshCart: () => Promise<void>;
};

const CartContext = createContext<CartContextValue | null>(null);

const emptyCart: Cart = {
  id: 'demo-cart',
  items: [],
  subtotal: 0,
  itemCount: 0,
  currency: 'INR',
};

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshCart = useCallback(async () => {
    try {
      const next = await api.getCart();
      setCart(next);
    } catch {
      setCart(emptyCart);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshCart();
  }, [refreshCart]);

  const value = useMemo(
    () => ({ cart, loading, refreshCart }),
    [cart, loading, refreshCart],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
