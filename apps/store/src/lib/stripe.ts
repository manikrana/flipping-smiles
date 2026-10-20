import Stripe from "stripe";

let cachedStripe: Stripe | null = null;

// Lazy so importing this module doesn't throw when Stripe isn't configured
// yet (dev/test-mode bypass uses the dummy-payment path instead and never
// calls this).
export function getStripe(): Stripe {
  if (!cachedStripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY environment variable is not set");
    }
    cachedStripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return cachedStripe;
}
