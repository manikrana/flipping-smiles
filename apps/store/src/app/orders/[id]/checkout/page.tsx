import { redirect } from "next/navigation";

// Retired in favor of the cart-aware checkout, which handles both solo and
// multi-book purchases. Kept as a redirect so old links/bookmarks don't 404.
export default function CheckoutPage() {
  redirect("/cart");
}
