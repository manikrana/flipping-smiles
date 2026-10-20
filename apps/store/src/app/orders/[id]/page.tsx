import { createServerClient } from "@/lib/supabase/server";
import { signAssets } from "@/lib/supabase/assets";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PreviewGenerator } from "./PreviewGenerator";
import { WizardProgress } from "@/components/WizardProgress";
import { DEFAULT_TEXT_STYLE, DEFAULT_TEXT_PANEL_BG, type LayoutType, type TextStyle, type TextPanelBg } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const SHIPPING_STATUS_COPY: Record<string, string> = {
  sent_to_print: "Your book is being printed",
  shipped: "Your book has shipped",
  delivered: "Your book has been delivered",
};

const PREVIEW_PAGE_COUNT = 3;

export default async function OrderConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: order, error } = await supabase
    .from("orders")
    .select("*, stories(id, title, slug, price_usd, cover_image_url, layout_type, text_style, text_panel_bg)")
    .eq("id", id)
    .single();

  if (error || !order) notFound();

  const story = order.stories as unknown as {
    id: string;
    title: string;
    slug: string;
    price_usd: number;
    cover_image_url: string | null;
    layout_type: LayoutType;
    text_style: TextStyle | null;
    text_panel_bg: TextPanelBg | null;
  };
  const textStyle = { ...DEFAULT_TEXT_STYLE, ...(story.text_style ?? {}) };
  const textPanelBg = story.text_panel_bg ?? DEFAULT_TEXT_PANEL_BG;

  // Text is never baked into the scene art itself except for overlay_bottom
  // layout (order_pages.text_image_url, composited server-side with the real
  // hero name) -- split/spread layouts render it live from story_pages.text,
  // same as apps/studio's admin order preview, so it has to be fetched and
  // matched up by page_number here too.
  const { data: orderPages } = await supabase
    .from("order_pages")
    .select("page_number, image_url, text_image_url, generation_status")
    .eq("order_id", id)
    .eq("generation_status", "done")
    .order("page_number", { ascending: true })
    .limit(PREVIEW_PAGE_COUNT);

  const donePages = orderPages ?? [];
  const pageNumbers = donePages.map((p) => p.page_number);
  const { data: storyPages } = pageNumbers.length > 0
    ? await supabase
        .from("story_pages")
        .select("page_number, text, text_bg_url, vertical_align")
        .eq("story_id", story.id)
        .in("page_number", pageNumbers)
    : { data: [] as { page_number: number; text: string; text_bg_url: string | null; vertical_align: "top" | "center" | "bottom" | null }[] };
  const storyPageByNum = Object.fromEntries((storyPages ?? []).map((p) => [p.page_number, p]));

  const imagePaths = donePages.flatMap((p) => [p.image_url, p.text_image_url]).filter((p): p is string => !!p);
  const textBgPaths = (storyPages ?? []).map((p) => p.text_bg_url).filter((p): p is string => !!p);
  const signedMap = await signAssets(supabase, [...imagePaths, ...textBgPaths]);

  const existingPages = donePages
    .filter((p): p is typeof p & { image_url: string } => !!p.image_url)
    .map((p) => {
      const sp = storyPageByNum[p.page_number];
      return {
        pageNumber: p.page_number,
        imageUrl: signedMap[p.image_url] ?? p.image_url,
        textImageUrl: p.text_image_url ? (signedMap[p.text_image_url] ?? p.text_image_url) : null,
        text: (sp?.text ?? "").replace(/{{hero_name}}/g, order.hero_name),
        textBgUrl: sp?.text_bg_url ? (signedMap[sp.text_bg_url] ?? sp.text_bg_url) : null,
      };
    });

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-brand-100 via-accent-100 to-cream">
      {/* overflow-hidden isolated to this layer only -- it breaks position:sticky on ancestors */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-40 -right-32 w-96 h-96 rounded-full bg-brand-400/35 blur-3xl" />
        <div className="absolute bottom-0 -left-32 w-96 h-96 rounded-full bg-accent-400/30 blur-3xl" />
      </div>
      {/* Top bar -- floating inset pill, matching the nav's treatment */}
      <div className="sticky top-20 z-10 px-4">
        <div className="max-w-6xl mx-auto glass rounded-full px-6 py-3 flex items-center justify-between">
          <Link href={`/books/${story.slug}`} className="text-sm text-ink/40 hover:text-ink transition-colors flex items-center gap-1 shrink-0">
            ← Back to book
          </Link>
          <WizardProgress current={2} />
          <span className="hidden sm:inline text-xs text-ink/30 font-mono shrink-0">{id.slice(0, 8)}</span>
        </div>
      </div>

      <div className="relative max-w-lg mx-auto px-6 pt-10 pb-20">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-ink mb-1">
            {existingPages.length > 0 ? `${order.hero_name}'s adventure` : `Creating ${order.hero_name}'s preview…`}
          </h1>
          <p className="text-sm text-ink/40">
            {story.title}
          </p>
        </div>

        {SHIPPING_STATUS_COPY[order.status] && (
          <div className="glass rounded-3xl p-5 mb-6 flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-ink">{SHIPPING_STATUS_COPY[order.status]}</p>
              {order.tracking_number && (
                <p className="text-xs text-ink/50 mt-1">
                  {order.carrier_name ? `${order.carrier_name} — ` : ""}
                  <span className="font-mono">{order.tracking_number}</span>
                </p>
              )}
            </div>
            {order.tracking_url && (
              <a
                href={order.tracking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-sm font-semibold text-brand-600 hover:text-brand-700 underline underline-offset-2"
              >
                Track package →
              </a>
            )}
          </div>
        )}

        <PreviewGenerator
          orderId={id}
          existingPages={existingPages}
          storyTitle={story.title}
          priceUsd={story.price_usd}
          heroName={order.hero_name}
          bookSlug={story.slug}
          layoutType={story.layout_type}
          textStyle={textStyle}
          textPanelBg={textPanelBg}
        />
      </div>
    </div>
  );
}
