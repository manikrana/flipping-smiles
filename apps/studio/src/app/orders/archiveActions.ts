"use server";

import { createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function archiveOrders(orderIds: string[]) {
  if (orderIds.length === 0) return;
  const supabase = createServerClient();
  const { error } = await supabase
    .from("orders")
    .update({ archived: true })
    .in("id", orderIds);
  if (error) throw new Error(error.message);
  revalidatePath("/orders");
}

export async function unarchiveOrders(orderIds: string[]) {
  if (orderIds.length === 0) return;
  const supabase = createServerClient();
  const { error } = await supabase
    .from("orders")
    .update({ archived: false })
    .in("id", orderIds);
  if (error) throw new Error(error.message);
  revalidatePath("/orders");
}
