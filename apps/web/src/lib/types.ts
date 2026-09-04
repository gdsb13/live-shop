export type ProductSummary = {
  id: string;
  name: string;
  category: string;
  brand: string;
  description: string;
  basePrice: number;
  image: string;
  rating: number;
  inStock: boolean;
  variantCount: number;
  priceFrom: number;
  listPrice?: number;
  discountEligible?: boolean;
  discountPercent?: number;
  discountAmount?: number;
  effectivePrice?: number;
};

export type ProductVariant = {
  id: string;
  name: string;
  sku: string;
  price: number;
  inStock: boolean;
  attributes: Record<string, string>;
};

export type Product = {
  id: string;
  name: string;
  category: string;
  brand: string;
  description: string;
  basePrice: number;
  images: string[];
  variants: ProductVariant[];
  specifications: Record<string, string>;
  features: string[];
  rating: number;
  inStock: boolean;
};

export type CartItem = {
  id: string;
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  brand: string;
  image: string;
  listPrice?: number;
  unitPrice: number;
  discountEligible?: boolean;
  discountPercent?: number;
  discountAmount?: number;
  effectiveUnitPrice?: number;
  effectivePrice?: number;
  originatingLiveSessionId?: string | null;
  quantity: number;
  lineTotal: number;
};

export type Cart = {
  id: string;
  items: CartItem[];
  subtotal: number;
  discountTotal?: number;
  itemCount: number;
  currency: string;
};

export type Serviceability = {
  pin: string;
  serviceable: boolean;
  message: string;
  codAvailable: boolean;
  estimatedDeliveryDays: number | null;
  estimatedDeliveryDate: string | null;
};

export type PaymentOption = {
  id: string;
  label: string;
  description: string;
  mock: boolean;
};

export type Order = {
  orderId: string;
  status: string;
  paymentMethod: string;
  deliveryPin: string | null;
  currency: string;
  subtotal: number;
  items: Array<{
    productId: string;
    variantId: string;
    productName: string;
    variantName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  message: string;
  createdAt: string;
};

export type LiveSessionStatus = 'SCHEDULED' | 'LIVE' | 'ENDED';

export type LiveSession = {
  id: string;
  title: string;
  description: string;
  hostName: string;
  status: LiveSessionStatus;
  scheduledAt: string;
  startedAt: string | null;
  endedAt: string | null;
  productIds: string[];
  featuredProductId: string | null;
  thumbnail: string;
  recordingUrl: string | null;
  products: ProductSummary[];
  featuredProduct: ProductSummary | null;
};

export type LiveSessionList = {
  count: number;
  live: LiveSession[];
  scheduled: LiveSession[];
  ended: LiveSession[];
  sessions: LiveSession[];
};
