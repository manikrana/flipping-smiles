import type { Language } from "./story";

export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "generating"
  | "pdf_ready"
  | "sent_to_print"
  | "shipped"
  | "delivered";

export interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface Order {
  id: string;
  storyId: string;
  characterId: string;
  language: Language;
  heroName: string;
  status: OrderStatus;
  stripePaymentIntentId?: string;
  pdfUrl?: string;
  shippingAddress: ShippingAddress;
  amountUsd: number;
  createdAt: string;
  updatedAt: string;
}
