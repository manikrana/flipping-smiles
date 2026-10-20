import { createServerClient } from "@/lib/supabase/server";
import { signAssets, resolveStoragePath } from "@/lib/supabase/assets";
import { getCompanyName } from "@/lib/brand";
import { notFound } from "next/navigation";
import Link from "next/link";
import { TrackedImage } from "@/components/TrackedImage";
import { FrontCoverOverlay } from "@/components/FrontCoverOverlay";
import { FRONT_COVER_IMAGE_CLASSES } from "@/lib/coverCrop";
import { DEFAULT_COVER_LAYOUT } from "@/lib/supabase/types";
import { pickDefaultHeroName } from "@/lib/heroNames";

export const dynamic = "force-dynamic";

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = createServerClient();

  const [{ data: story, error }, companyName] = await Promise.all([
    supabase
      .from("stories")
      .select("*")
      .eq("slug", slug)
      .eq("status", "ready")
      .eq("archived", false)
      .single(),
    getCompanyName(),
  ]);

  if (error || !story) notFound();
  const layout = { ...DEFAULT_COVER_LAYOUT, ...(story.cover_layout ?? {}) };

  const coverPath = story.cover_image_url ? resolveStoragePath(story.cover_image_url) : null;
  if (coverPath) {
    const signedMap = await signAssets(supabase, [coverPath]);
    story.cover_image_url = signedMap[coverPath] ?? story.cover_image_url;
  }

  // fire-and-forget server-side event — never awaited, never blocks render
  void Promise.resolve(
    supabase.from("analytics_events").insert({
      event_name: "book_viewed",
      story_id: story.id,
      properties: { slug },
    })
  ).catch(() => {});

  return (
    <div className="relative pt-16 min-h-screen bg-gradient-to-b from-brand-100 via-accent-100 to-cream overflow-hidden">
      <div className="absolute top-24 -right-32 w-[28rem] h-[28rem] rounded-full bg-brand-400/40 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 -left-32 w-96 h-96 rounded-full bg-accent-400/35 blur-3xl pointer-events-none" />
      <div className="relative max-w-6xl mx-auto px-6 py-12">
        <Link href="/books" className="inline-flex items-center gap-1.5 text-sm text-ink/40 hover:text-ink transition-colors mb-10">
          ← Back to all books
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          {/* Cover */}
          <div className="lg:sticky lg:top-24">
            <div className="relative aspect-square bg-brand-50 rounded-3xl overflow-hidden shadow-card-hover" style={{ containerType: "size" }}>
              {story.cover_image_url ? (
                <>
                  <TrackedImage
                    context="book_cover_detail"
                    storyId={story.id}
                    src={story.cover_image_url}
                    alt={story.title}
                    className={`w-full h-full ${FRONT_COVER_IMAGE_CLASSES}`}
                  />
                  {/* "boy" matches cover_image_url above -- keep them in sync if a girl cover ever renders here */}
                  <FrontCoverOverlay
                    title={story.title}
                    subtitle={layout.subtitle.replace(/{{hero_name}}/g, pickDefaultHeroName(story.id, "boy"))}
                    companyName={companyName}
                    titlePosition={layout.titlePosition}
                    titleColor={layout.titleColor}
                    subtitleColor={layout.subtitleColor}
                    titleSize={layout.titleSize}
                    subtitleSize={layout.subtitleSize}
                    overlayOpacity={layout.overlayOpacity}
                    fontFamily={layout.fontFamily}
                  />
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-8xl">📖</div>
              )}
            </div>

            {/* Trust badges */}
            <div className="grid grid-cols-3 gap-3 mt-5">
              {[
                { icon: "👁️", label: "Free Preview" },
                { icon: "🔒", label: "Photo Privacy" },
                { icon: "⭐", label: "Guaranteed" },
              ].map((b) => (
                <div key={b.label} className="glass rounded-2xl p-3 text-center">
                  <div className="text-lg mb-1">{b.icon}</div>
                  <div className="text-xs font-medium text-ink/50">{b.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Info + form */}
          <div>
            <div className="mb-2">
              <span className="text-xs font-semibold text-brand-600 uppercase tracking-widest">
                Ages {story.age_min}–{story.age_max}
              </span>
            </div>
            <h1 className="font-display text-4xl font-bold text-ink mb-3 leading-tight">
              {story.title}
            </h1>

            <div className="flex items-center gap-3 mb-4">
              <span className="text-brand-500">★★★★★</span>
              <span className="text-sm text-ink/40">4.9 · Loved by 500+ families</span>
            </div>

            <p className="text-ink/60 leading-relaxed mb-6">{story.description}</p>

            <div className="flex items-center gap-2 mb-8">
              <span className="text-2xl font-display font-bold text-ink">${story.price_usd}</span>
              <span className="text-sm text-ink/40">hardcover · free preview included</span>
            </div>

            <div className="glass rounded-3xl p-7 text-center">
              <h2 className="font-display font-semibold text-xl text-ink mb-2">Ready to meet your hero?</h2>
              <p className="text-sm text-ink/50 mb-6">Add a photo (or pick a ready-made character), and we&apos;ll build a free preview in about a minute.</p>
              <Link
                href={`/books/${story.slug}/create`}
                className="inline-flex items-center justify-center gap-2 w-full bg-brand-500 hover:bg-brand-600 text-white font-bold py-4 rounded-2xl text-base transition-all hover:scale-[1.02] shadow-warm"
              >
                Try Now for Free →
              </Link>
              <p className="text-xs text-ink/35 mt-3">Preview is completely free. We only charge when you approve your book.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
