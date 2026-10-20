import { createServerClient } from "@/lib/supabase/server";
import { signAssets } from "@/lib/supabase/assets";
import Link from "next/link";
import { OrdersList, type OrderItem } from "./OrdersList";
import { GenerationQueue, type QueueItem } from "./GenerationQueue";

export const dynamic = "force-dynamic";

type RawOrder = {
  id: string;
  hero_name: string;
  language: string;
  status: string;
  amount_usd: number;
  archived: boolean;
  created_at: string;
  stories: { id: string; title: string } | null;
  characters: {
    cartoon_image_url: string | null;
    sheet_url: string | null;
    generation_status: string;
    is_default: boolean;
  } | null;
  order_pages: { generation_status: string }[];
};

export default async function OrdersPage() {
  const supabase = createServerClient();

  const { data: rawOrders, error } = await supabase
    .from("orders")
    .select("id, hero_name, language, status, amount_usd, archived, created_at, stories ( id, title ), characters ( cartoon_image_url, sheet_url, generation_status, is_default ), order_pages ( generation_status )")
    .order("created_at", { ascending: false });

  if (error) {
    return <p className="text-red-500">Failed to load orders: {error.message}</p>;
  }

  const raw = (rawOrders ?? []) as unknown as RawOrder[];

  // Sign cartoon thumbnails for the generation queue
  const cartoonPaths = raw
    .filter((o) => o.status === "paid" && o.characters?.cartoon_image_url)
    .map((o) => o.characters!.cartoon_image_url!);
  const signedMap = await signAssets(supabase, cartoonPaths);

  const queue: QueueItem[] = raw
    .filter((o) => o.status === "paid" && !o.archived)
    .map((o) => ({
      id: o.id,
      hero_name: o.hero_name,
      story: o.stories,
      created_at: o.created_at,
      cartoon_ready: !!(o.characters?.is_default || (o.characters?.cartoon_image_url && o.characters.generation_status === "done")),
      cartoon_image_url: o.characters?.cartoon_image_url
        ? (signedMap[o.characters.cartoon_image_url] ?? null)
        : null,
    }));

  const orders: OrderItem[] = raw.map((o) => ({
    id: o.id,
    hero_name: o.hero_name,
    language: o.language,
    status: o.status,
    amount_usd: o.amount_usd,
    archived: o.archived ?? false,
    created_at: o.created_at,
    story: o.stories,
    needs_attention: o.status === "generating" && (o.order_pages ?? []).some((p) => p.generation_status === "failed"),
  }));

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Orders</h1>
        <p className="text-sm text-gray-400">{orders.length} total</p>
      </div>

      {queue.length > 0 && <GenerationQueue items={queue} />}

      <OrdersList orders={orders} />
    </div>
  );
}
