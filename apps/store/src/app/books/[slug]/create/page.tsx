import { createServerClient } from "@/lib/supabase/server";
import { signAssets, resolveStoragePath } from "@/lib/supabase/assets";
import { getCompanyName } from "@/lib/brand";
import { notFound } from "next/navigation";
import Link from "next/link";
import { OrderForm } from "../OrderForm";
import { WizardProgress } from "@/components/WizardProgress";
import { TrackedImage } from "@/components/TrackedImage";
import { FrontCoverOverlay } from "@/components/FrontCoverOverlay";
import { FRONT_COVER_IMAGE_CLASSES } from "@/lib/coverCrop";
import { DEFAULT_COVER_LAYOUT } from "@/lib/supabase/types";
import { pickDefaultHeroName } from "@/lib/heroNames";

export const dynamic = "force-dynamic";

export default async function CreatePage({ params }: { params: Promise<{ slug: string }> }) {
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

  const { data: rawDefaultCharacters } = await supabase
    .from("characters")
    .select("id, cartoon_image_url, default_gender")
    .eq("is_default", true);

  const charPaths = (rawDefaultCharacters ?? [])
    .map((c) => c.cartoon_image_url)
    .filter((p): p is string => !!p);
  const coverPath = story.cover_image_url ? resolveStoragePath(story.cover_image_url) : null;
  const pathsToSign = coverPath ? [...charPaths, coverPath] : charPaths;
  const signedMap = await signAssets(supabase, pathsToSign);
  const defaultCharacters = (rawDefaultCharacters ?? []).map((c) => ({
    ...c,
    cartoon_image_url: c.cartoon_image_url ? (signedMap[c.cartoon_image_url] ?? null) : null,
  }));
  if (coverPath) {
    story.cover_image_url = signedMap[coverPath] ?? story.cover_image_url;
  }

  return (
    <div className="relative pt-20 min-h-screen bg-gradient-to-b from-brand-100 via-accent-100 to-cream">
      {/* overflow-hidden isolated to this layer only -- it breaks position:sticky on ancestors */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-40 -right-32 w-96 h-96 rounded-full bg-brand-400/35 blur-3xl" />
        <div className="absolute bottom-0 -left-32 w-96 h-96 rounded-full bg-accent-400/30 blur-3xl" />
      </div>

      {/* Top bar -- floating inset pill, matching the nav's treatment */}
      <div className="sticky top-20 z-10 px-4">
        <div className="max-w-6xl mx-auto glass rounded-full px-6 py-3 flex items-center justify-between">
          <Link href={`/books/${slug}`} className="text-sm text-ink/40 hover:text-ink transition-colors flex items-center gap-1 shrink-0">
            ← Back to book
          </Link>
          <WizardProgress current={1} />
          <span className="hidden sm:inline w-20" />
        </div>
      </div>

      <div className="relative max-w-lg mx-auto px-6 pt-10 pb-20">
        <div className="flex items-center gap-3 mb-8">
          <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-brand-50 shrink-0 shadow-sm" style={{ containerType: "size" }}>
            {story.cover_image_url ? (
              <>
                <TrackedImage
                  context="create_page_cover_reminder"
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
              <div className="w-full h-full flex items-center justify-center text-xl">📖</div>
            )}
          </div>
          <div>
            <p className="text-xs text-ink/40 font-medium">Personalizing</p>
            <h1 className="font-display text-lg font-semibold text-ink leading-tight">{story.title}</h1>
          </div>
        </div>

        <div className="glass rounded-3xl p-7">
          <OrderForm story={story} defaultCharacters={defaultCharacters ?? []} />
        </div>
      </div>
    </div>
  );
}
