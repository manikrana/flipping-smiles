"use server";

import { createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { BrandSettingsRow } from "@/lib/supabase/types";

export async function getBrandSettings(): Promise<BrandSettingsRow> {
  const supabase = createServerClient();
  const { data, error } = await supabase.from("brand_settings").select("*").eq("id", "default").single();
  if (error || !data) throw new Error(error?.message ?? "Brand settings not found");
  return data;
}

export async function saveBrandSettings(data: {
  company_name: string | null;
  website_url: string | null;
  instagram_url: string | null;
  back_cover_leading_text: string | null;
}) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("brand_settings")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", "default");
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}
