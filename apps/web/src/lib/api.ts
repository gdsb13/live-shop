const API_BASE =
  typeof window === 'undefined'
    ? process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001'
    : '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };

  if (init?.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }

  return res.json();
}

export const api = {
  getProducts: (params?: { category?: string; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.category) query.set('category', params.category);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return request<{
      categories: string[];
      count: number;
      products: import('./types').ProductSummary[];
    }>(`/api/products${qs ? `?${qs}` : ''}`);
  },

  getProduct: (id: string) =>
    request<import('./types').Product>(`/api/products/${id}`),

  getCart: () => request<import('./types').Cart>('/api/cart'),

  addToCart: (body: { productId: string; variantId: string; quantity: number }) =>
    request<import('./types').Cart>('/api/cart/items', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateCartItem: (itemId: string, quantity: number) =>
    request<import('./types').Cart>(`/api/cart/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ quantity }),
    }),

  removeCartItem: (itemId: string) =>
    request<import('./types').Cart>(`/api/cart/items/${itemId}`, {
      method: 'DELETE',
    }),

  checkServiceability: (pin: string) =>
    request<import('./types').Serviceability>(
      `/api/serviceability?pin=${encodeURIComponent(pin)}`,
    ),

  getPaymentOptions: () =>
    request<{ currency: string; options: import('./types').PaymentOption[] }>(
      '/api/payment-options',
    ),

  checkout: (body: { paymentMethod: string; deliveryPin?: string }) =>
    request<import('./types').Order>('/api/checkout', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getLiveSessions: () =>
    request<import('./types').LiveSessionList>('/api/live-sessions'),

  getLiveSession: (id: string) =>
    request<import('./types').LiveSession>(`/api/live-sessions/${id}`),

  startLiveSession: (id: string) =>
    request<import('./types').LiveSession>(`/api/live-sessions/${id}/start`, {
      method: 'POST',
    }),

  endLiveSession: (id: string) =>
    request<import('./types').LiveSession>(`/api/live-sessions/${id}/end`, {
      method: 'POST',
    }),

  setFeaturedProduct: (sessionId: string, productId: string) =>
    request<import('./types').LiveSession>(
      `/api/live-sessions/${sessionId}/featured-product`,
      {
        method: 'PATCH',
        body: JSON.stringify({ productId }),
      },
    ),

  getAgoraRtcToken: (body: {
    liveSessionId: string;
    userId: string;
    role: import('./agora/types').AgoraRtcRole;
  }) =>
    request<import('./agora/types').AgoraRtcToken>('/api/agora/rtc-token', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getHostBroadcastStatus: (sessionId: string) =>
    request<{ broadcasting: boolean; hostUserId: string | null }>(
      `/api/agora/host-status/${encodeURIComponent(sessionId)}`,
    ),

  claimHostBroadcast: (body: { liveSessionId: string; userId: string }) =>
    request<{ sessionId: string; hostUserId: string; broadcasting: boolean }>(
      '/api/agora/host-claim',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  heartbeatHostBroadcast: (body: { liveSessionId: string; userId: string }) =>
    request<{ broadcasting: boolean; hostUserId: string | null }>(
      '/api/agora/host-heartbeat',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  releaseHostBroadcast: (body: { liveSessionId: string; userId: string }) =>
    request<{ released: boolean }>('/api/agora/host-release', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getAgoraRtmToken: (body: { liveSessionId: string; userId: string }) =>
    request<import('./agora/types').AgoraRtmToken>('/api/agora/rtm-token', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getChatMessages: (sessionId: string) =>
    request<{ messages: import('./agora/types').LiveChatMessage[] }>(
      `/api/chat/${encodeURIComponent(sessionId)}`,
    ),

  postChatMessage: (sessionId: string, body: { sender: string; text: string }) =>
    request<import('./agora/types').LiveChatMessage>(
      `/api/chat/${encodeURIComponent(sessionId)}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),
};
