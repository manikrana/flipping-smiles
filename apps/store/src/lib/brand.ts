import { createServerClient } from "./supabase/server";

// The single global brand_settings row (apps/studio owns editing it via
// Settings) -- the storefront only needs the company name, to composite as
// the small front-cover imprint (see components/FrontCoverOverlay.tsx),
// matching what the print pipeline bakes in (apps/studio/src/lib/layout.ts's
// renderCoverSpread).
export async function getCompanyName(): Promise<string | null> {
  const supabase = createServerClient();
  const { data } = await supabase.from("brand_settings").select("company_name").eq("id", "default").single();
  return data?.company_name ? `${data.company_name}™` : null;
}
