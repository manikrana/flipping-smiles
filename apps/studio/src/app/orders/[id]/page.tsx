import { createServerClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageGenerator } from "../generate/PageGenerator";
import { OrderBookPreview } from "./OrderBookPreview";
import { CharacterPipeline } from "./CharacterPipeline";
import { signAssets, resolveStoragePath } from "@/lib/supabase/assets";
import { getCoverPreviewData } from "../../stories/book/actions";
import { OrderCostPanel } from "./OrderCostPanel";
import type { StoryRow, StoryPageRow, OrderPageRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  pending_payment: "bg-yellow-100 text-yellow-700",
  paid:            "bg-blue-100 text-blue-700",
  generating:      "bg-purple-100 text-purple-700",
  preview_ready:   "bg-amber-100 text-amber-700",
  sent_to_print:   "bg-green-100 text-green-700",
  shipped:         "bg-green-200 text-green-800",
  delivered:       "bg-green-300 text-green-900",
};

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  type OrderWithRelations = {
    id: string;
    hero_name: string;
    gender: string;
    language: string;
    status: string;
    amount_usd: number;
    created_at: string;
    shipping_address: Record<string, string>;
    tracking_number: string | null;
    tracking_url: string | null;
    carrier_name: string | null;
    pdf_url: string | null;
    cover_image_url: string | null;
    stories: StoryRow & {
      story_pages: StoryPageRow[];
    } | null;
    characters: {
      id: string;
      source_image_url: string | null;
      cartoon_image_url: string | null;
      sheet_url: string | null;
      generation_status: "pending" | "processing" | "done" | "failed";
      replicate_job_id: string | null;
      is_default: boolean;
      default_gender: "boy" | "girl" | null;
    } | null;
    order_pages: OrderPageRow[];
  };

  const { data: rawOrder, error } = await supabase
    .from("orders")
    .select(`
      id, hero_name, gender, language, status, amount_usd, created_at, shipping_address,
      tracking_number, tracking_url, carrier_name, pdf_url, cover_image_url,
      stories (
        *, story_pages ( * )
      ),
      characters ( id, source_image_url, cartoon_image_url, sheet_url, generation_status, replicate_job_id, is_default, default_gender ),
      order_pages ( * )
    `)
    .eq("id", id)
    .single();

  if (error || !rawOrder) notFound();

  const order = rawOrder as unknown as OrderWithRelations;

  const { data: costCalls } = await supabase
    .from("gemini_call_log")
    .select("call_type, page_id, estimated_cost_usd")
    .eq("order_id", id);

  const story = order.stories;
  const storyPages = [...(story?.story_pages ?? [])].sort((a, b) => a.page_number - b.page_number);
  const orderPages = [...order.order_pages].sort((a, b) => a.page_number - b.page_number);

  // Every image reference on this page is a bare, private-bucket storage path
  // (or a legacy full URL) -- none of it renders as-is, it all needs signing
  // before it can be used as an <img src>.
  const rawPaths = new Set<string>();
  if (order.characters?.source_image_url) rawPaths.add(resolveStoragePath(order.characters.source_image_url));
  if (order.characters?.cartoon_image_url) rawPaths.add(resolveStoragePath(order.characters.cartoon_image_url));
  if (order.characters?.sheet_url) rawPaths.add(resolveStoragePath(order.characters.sheet_url));
  if (story?.cover_image_url) rawPaths.add(resolveStoragePath(story.cover_image_url));
  if (story?.brand_page_image_url) rawPaths.add(resolveStoragePath(story.brand_page_image_url));
  if (story?.end_page_image_url) rawPaths.add(resolveStoragePath(story.end_page_image_url));
  if (order.cover_image_url) rawPaths.add(resolveStoragePath(order.cover_image_url));
  if (order.pdf_url) rawPaths.add(resolveStoragePath(order.pdf_url));
  for (const sp of storyPages) {
    if (sp.image_url) rawPaths.add(resolveStoragePath(sp.image_url));
    if (sp.text_bg_url) rawPaths.add(resolveStoragePath(sp.text_bg_url));
  }
  for (const op of orderPages) {
    if (op.image_url) rawPaths.add(resolveStoragePath(op.image_url));
    if (op.text_image_url) rawPaths.add(resolveStoragePath(op.text_image_url));
  }
  const signedMap = await signAssets(supabase, [...rawPaths]);
  const sign = (url: string | null): string | null => (url ? (signedMap[resolveStoragePath(url)] ?? null) : null);

  const signedCharacter = order.characters && {
    ...order.characters,
    source_image_url: sign(order.characters.source_image_url),
    cartoon_image_url: sign(order.characters.cartoon_image_url),
    sheet_url: sign(order.characters.sheet_url),
  };
  const signedStory = story && { ...story, cover_image_url: sign(story.cover_image_url), brand_page_image_url: sign(story.brand_page_image_url), end_page_image_url: sign(story.end_page_image_url) };
  const signedStoryPages = storyPages.map((sp) => ({
    ...sp,
    image_url: sign(sp.image_url),
    text_bg_url: sign(sp.text_bg_url),
  }));
  const signedOrderPages = orderPages.map((op) => ({
    ...op,
    image_url: sign(op.image_url),
    text_image_url: sign(op.text_image_url),
  }));

  const showPreview = ["preview_ready", "sent_to_print", "shipped", "delivered"].includes(order.status)
    || orderPages.some((p) => p.image_url);

  // Personalized cover if generated yet, falling back to the story template --
  // matches generateOrderPdf's own fallback exactly.
  const signedCoverUrl = sign(order.cover_image_url) ?? sign(story?.cover_image_url ?? null);
  const coverPreviewData = story && showPreview ? await getCoverPreviewData(story.id) : null;

  return (
    <div className="max-w-7xl space-y-6">
      {/* Header */}
      <div>
        <Link href="/orders" className="text-sm text-gray-400 hover:text-gray-600">← Orders</Link>
        <div className="flex items-start justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold">
              {order.hero_name}
              <span className="text-gray-400 font-normal text-lg ml-2">· {story?.title}</span>
            </h1>
            <p className="text-xs text-gray-400 mt-1">
              <span className="font-semibold uppercase tracking-wide mr-1.5">Order ID</span>
              <span className="font-mono select-all">{order.id}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-semibold">${order.amount_usd}</span>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_BADGE[order.status] ?? "bg-gray-100 text-gray-600"}`}>
              {order.status.replace(/_/g, " ")}
            </span>
          </div>
        </div>
      </div>

      {/* Order meta */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap gap-6 text-sm">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-0.5">Hero name</p>
          <p className="font-medium">{order.hero_name}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-0.5">Language</p>
          <p className="font-medium uppercase">{order.language}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-0.5">Ordered</p>
          <p className="font-medium">{new Date(order.created_at).toLocaleString()}</p>
        </div>
        {signedCharacter?.source_image_url && (
          <div className="flex items-center gap-3">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-0.5">Character photo</p>
              <img src={signedCharacter.source_image_url} alt="Character" className="w-12 h-12 rounded-full object-cover border border-gray-200" />
            </div>
          </div>
        )}
        {order.characters?.is_default && (
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-0.5">Character</p>
            <p className="font-medium text-gray-500">Ready-made (no photo)</p>
          </div>
        )}
        {order.tracking_number && (
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-0.5">Tracking</p>
            <p className="font-medium">
              {order.carrier_name ? `${order.carrier_name} — ` : ""}
              {order.tracking_url ? (
                <a href={order.tracking_url} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline font-mono">
                  {order.tracking_number}
                </a>
              ) : (
                <span className="font-mono">{order.tracking_number}</span>
              )}
            </p>
          </div>
        )}
      </div>

      {/* Gemini cost for this order */}
      {costCalls && costCalls.length > 0 && <OrderCostPanel calls={costCalls} />}

      {/* Character pipeline */}
      {signedCharacter && (
        <CharacterPipeline
          characterId={signedCharacter.id}
          sourceImageUrl={signedCharacter.source_image_url}
          cartoonImageUrl={signedCharacter.cartoon_image_url}
          sheetUrl={signedCharacter.sheet_url}
          isDefault={signedCharacter.is_default}
        />
      )}

      {/* Generation panel — shown when not yet in preview */}
      {!showPreview && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Generate personalised pages</h2>
          <PageGenerator
            orderId={order.id}
            initialPages={signedOrderPages}
            orderStatus={order.status}
            cartoonReady={!!order.characters?.cartoon_image_url}
          />
        </div>
      )}

      {/* Book preview */}
      {signedStory && showPreview && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Book preview</h2>
            {orderPages.some((p) => p.generation_status === "processing") && (
              <span className="text-xs text-purple-600 flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                Still generating — refresh to see updates
              </span>
            )}
          </div>
          <OrderBookPreview
            orderId={order.id}
            heroName={order.hero_name}
            gender={order.gender === "girl" ? "girl" : "boy"}
            orderStatus={order.status}
            story={signedStory}
            storyPages={signedStoryPages}
            orderPages={signedOrderPages}
            pdfUrl={sign(order.pdf_url)}
            coverUrl={signedCoverUrl}
            coverPreviewData={coverPreviewData}
          />
        </div>
      )}
    </div>
  );
}
