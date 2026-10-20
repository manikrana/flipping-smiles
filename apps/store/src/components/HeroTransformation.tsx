import Link from "next/link";
import { TrackedImage } from "./TrackedImage";

// The homepage hero's proof: a real photo -> its real Pixar-style cartoon ->
// a real generated scene, all genuine output from the actual generateScene()
// pipeline (not staged). "Let the photo do the talking" -- minimal chrome,
// the images carry the pitch.
export function HeroTransformation({
  photoUrl,
  cartoonUrl,
  sceneUrl,
  storyTitle,
  storySlug,
}: {
  photoUrl: string;
  cartoonUrl: string;
  sceneUrl: string;
  storyTitle: string;
  storySlug: string;
}) {
  return (
    <div className="w-full max-w-[260px] sm:max-w-md mx-auto lg:mx-0">
      {/* The transformation itself: photo -> cartoon */}
      <div className="flex items-center gap-3 mb-3 sm:mb-5">
        <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-2xl overflow-hidden border-4 border-white shadow-card shrink-0 rotate-[-3deg]">
          <TrackedImage
            context="homepage_hero_photo"
            src={photoUrl}
            alt="A child's photo"
            className="w-full h-full object-cover"
          />
        </div>
        <span className="text-2xl text-brand-400 shrink-0" aria-hidden="true">→</span>
        <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-2xl overflow-hidden border-4 border-white shadow-card shrink-0 rotate-[2deg]">
          <TrackedImage
            context="homepage_hero_cartoon"
            src={cartoonUrl}
            alt="The same child, illustrated as a Pixar-style hero"
            className="w-full h-full object-cover"
          />
        </div>
        <span className="text-2xl text-brand-400 shrink-0" aria-hidden="true">→</span>
      </div>

      {/* The scene -- dominant, sharp, real */}
      <Link
        href={`/books/${storySlug}`}
        className="group block relative rounded-[28px] overflow-hidden shadow-card-hover border-4 border-white aspect-square"
      >
        <TrackedImage
          context="homepage_hero_scene"
          src={sceneUrl}
          alt={`The same child as the hero of ${storyTitle}`}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <div className="absolute bottom-0 inset-x-0 px-5 py-4 bg-gradient-to-t from-black/65 to-transparent">
          <span className="text-white text-sm font-semibold">See {storyTitle} →</span>
        </div>
      </Link>
    </div>
  );
}
