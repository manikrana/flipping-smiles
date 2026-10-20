import Link from "next/link";
import { DEFAULT_COVER_LAYOUT, type StoryRow } from "@/lib/supabase/types";
import { TrackedImage } from "./TrackedImage";
import { FrontCoverOverlay } from "./FrontCoverOverlay";
import { FRONT_COVER_IMAGE_CLASSES } from "@/lib/coverCrop";
import { pickDefaultHeroName } from "@/lib/heroNames";

const STARS = "★★★★★";

export function BookCard({ story, companyName }: { story: StoryRow; companyName: string | null }) {
  const layout = { ...DEFAULT_COVER_LAYOUT, ...(story.cover_layout ?? {}) };
  return (
    <Link
      href={`/books/${story.slug}/create`}
      className="group block glass rounded-3xl overflow-hidden transition-transform duration-150 ease-out active:scale-[0.98] hover:-translate-y-1"
    >
      <div className="relative aspect-square bg-brand-100 overflow-hidden" style={{ containerType: "size" }}>
        {story.cover_image_url ? (
          <>
            <TrackedImage
              context="book_cover_card"
              storyId={story.id}
              src={story.cover_image_url}
              alt={story.title}
              className={`w-full h-full transition-transform duration-300 ${FRONT_COVER_IMAGE_CLASSES} group-hover:scale-[1.19]`}
            />
            {/* "boy" matches cover_image_url below -- keep them in sync if a girl cover ever renders here */}
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
          <div className="w-full h-full flex items-center justify-center text-6xl">📖</div>
        )}
        <div className="absolute top-3 left-3 glass text-xs font-semibold text-ink/70 px-2.5 py-1 rounded-full">
          Ages {story.age_min}–{story.age_max}
        </div>
      </div>

      <div className="p-5">
        <div className="text-brand-500 text-sm tracking-widest mb-1.5">{STARS}</div>
        <h3 className="font-display font-semibold text-lg text-ink leading-snug mb-1">
          {story.title}
        </h3>
        <p className="text-ink/50 text-sm leading-relaxed line-clamp-2 mb-4">
          {story.description}
        </p>

        <div className="flex items-center justify-between">
          <span className="font-display font-bold text-ink">${story.price_usd}</span>
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 group-hover:text-brand-700 transition-colors">
            Try Now for Free
            <span aria-hidden="true">→</span>
          </span>
        </div>
      </div>
    </Link>
  );
}
