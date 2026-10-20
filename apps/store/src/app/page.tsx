import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { signAssets, resolveStoragePath } from "@/lib/supabase/assets";
import { getCompanyName } from "@/lib/brand";
import { AnimatedSection } from "@/components/AnimatedSection";
import { BookCard } from "@/components/BookCard";
import { FAQAccordion } from "@/components/FAQAccordion";
import { HeroTransformation } from "@/components/HeroTransformation";
import { Wordmark } from "@/components/Wordmark";

export const dynamic = "force-dynamic";

const REVIEWS = [
  {
    name: "Sarah M.",
    location: "New York, NY",
    text: "My daughter Emma saw herself as the hero of the story and absolutely lost her mind. She's made us read it every single night for three weeks.",
    initials: "SM",
    color: "bg-accent-400",
  },
  {
    name: "James T.",
    location: "Austin, TX",
    text: "Gifted this to my nephew for his birthday. His parents sent me a video of him opening it — pure joy. Best $40 I've ever spent.",
    initials: "JT",
    color: "bg-brand-400",
  },
  {
    name: "Priya K.",
    location: "San Jose, CA",
    text: "The illustration quality is stunning. Looks like a frame from a Pixar film. I was skeptical at first — now I've ordered three.",
    initials: "PK",
    color: "bg-brand-300",
  },
];

const WHY = [
  {
    icon: "👁️",
    title: "Free Preview First",
    body: "See every personalized page of your child's book before we charge you a single dollar.",
  },
  {
    icon: "🔒",
    title: "Privacy First",
    body: "Your child's photo is only used to create the book and is never sold or shared for marketing. See our Privacy Policy for details.",
  },
  {
    icon: "⭐",
    title: "Satisfaction Guaranteed",
    body: "Not in love with your book? We'll redo it, no questions asked.",
  },
  {
    icon: "🎨",
    title: "Premium Print Quality",
    body: "Hardcover binding, thick vibrant pages, built to survive a thousand re-reads.",
  },
];

export default async function HomePage() {
  const supabase = createServerClient();
  const [{ data: stories }, companyName] = await Promise.all([
    supabase
      .from("stories")
      .select("*")
      .eq("status", "ready")
      .eq("archived", false)
      .order("created_at", { ascending: false })
      .limit(3),
    getCompanyName(),
  ]);

  const rawFeatured = stories ?? [];

  // cover_image_url is a private storage path (or, for some older rows, a
  // legacy full URL from before the bucket went private) — resolve + sign it.
  const coverPaths = rawFeatured
    .map((s) => (s.cover_image_url ? resolveStoragePath(s.cover_image_url) : null))
    .filter((p): p is string => !!p);
  const signedCoverMap = await signAssets(supabase, coverPaths);
  const featured = rawFeatured.map((s) => ({
    ...s,
    cover_image_url: s.cover_image_url ? (signedCoverMap[resolveStoragePath(s.cover_image_url)] ?? null) : null,
  }));

  // Hero transformation demo: a real photo -> its real Pixar-style cartoon ->
  // a real generated scene, genuine output from generateScene() (not staged
  // or mocked). Pinned to a specific story by slug, since these images are
  // tied to one particular real generation, not derived from whichever
  // story happens to be featured.
  const HERO_DEMO_STORY_SLUG = "discovering-wonders-of-india-v2";
  const heroMarketingPaths = [
    "marketing/hero/photo.jpg",
    "marketing/hero/cartoon.jpg",
    "marketing/hero/scene-taj-mahal.jpg",
  ];
  const signedHeroMarketing = await signAssets(supabase, heroMarketingPaths);
  const heroPhotoUrl = signedHeroMarketing["marketing/hero/photo.jpg"];
  const heroCartoonUrl = signedHeroMarketing["marketing/hero/cartoon.jpg"];
  const heroSceneUrl = signedHeroMarketing["marketing/hero/scene-taj-mahal.jpg"];

  const { data: heroDemoStory } = await supabase
    .from("stories")
    .select("title, slug")
    .eq("slug", HERO_DEMO_STORY_SLUG)
    .single();

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center pt-16 overflow-hidden bg-cream">
        <div className="absolute top-32 -right-32 w-[32rem] h-[32rem] rounded-full bg-brand-400/25 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 -left-32 w-96 h-96 rounded-full bg-accent-400/20 blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-6xl mx-auto px-6 py-6 lg:py-24 grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-16 items-center">

          {/* Text */}
          <div className="order-2 lg:order-1">
            <h1 className="font-display text-3xl sm:text-6xl lg:text-[4.5rem] font-bold text-ink leading-[1.05] tracking-tight mb-4">
              Every child deserves to be the{" "}
              <em className="text-brand-500 not-italic">hero</em>{" "}
              of their own story.
            </h1>
            <p className="text-base sm:text-lg text-ink/55 leading-relaxed max-w-lg mb-6">
              Upload a photo, pick a story, and watch your child transform into a Pixar-style character in their very own hardcover book.
            </p>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-10">
              <Link
                href="/books"
                className="inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white font-semibold px-8 py-4 rounded-full text-base transition-all hover:scale-105 shadow-warm"
              >
                Try Now for Free
                <span>→</span>
              </Link>
              <div className="flex flex-col gap-1.5">
                <span className="inline-flex items-center gap-1.5 text-sm text-ink/40">
                  <span aria-hidden="true">✨</span> Free preview in 30 seconds
                </span>
                <span className="inline-flex items-center gap-1.5 text-sm text-ink/40">
                  <span aria-hidden="true">💳</span> No credit card required
                </span>
              </div>
            </div>

            {/* Social proof */}
            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                {["SM", "JT", "PK", "AL"].map((i, idx) => (
                  <div
                    key={idx}
                    className={`w-8 h-8 rounded-full border-2 border-cream flex items-center justify-center text-xs font-bold text-white ${
                      ["bg-accent-400", "bg-brand-400", "bg-brand-600", "bg-accent-500"][idx]
                    }`}
                  >
                    {i}
                  </div>
                ))}
              </div>
              <div>
                <div className="text-brand-500 text-sm">★★★★★</div>
                <div className="text-xs text-ink/50">Loved by 500+ families</div>
              </div>
            </div>
          </div>

          {/* Hero visual -- the real transformation: photo, cartoon, scene */}
          <div className="order-1 lg:order-2 relative flex items-center justify-center w-full">
            <HeroTransformation
              photoUrl={heroPhotoUrl}
              cartoonUrl={heroCartoonUrl}
              sceneUrl={heroSceneUrl}
              storyTitle={heroDemoStory?.title ?? "Discovering Wonders of India"}
              storySlug={heroDemoStory?.slug ?? HERO_DEMO_STORY_SLUG}
            />
          </div>
        </div>
      </section>

      {/* ── How It Works ────────────────────────────────────────────────────── */}
      <section className="relative bg-gradient-to-b from-brand-200 via-accent-200 to-cream py-24 overflow-hidden">
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-brand-400/50 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 rounded-full bg-accent-400/40 blur-3xl" />
        <div className="max-w-6xl mx-auto px-6">
          <AnimatedSection className="text-center mb-16">
            <h2 className="font-display text-4xl font-bold text-ink mb-4">
              From photo to book in minutes
            </h2>
            <p className="text-ink/50 text-lg max-w-xl mx-auto">
              Three simple steps. One book they&apos;ll treasure forever.
            </p>
          </AnimatedSection>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                icon: "📸",
                title: "Upload a photo",
                body: "Any clear photo of your child works. Smiling, laughing, or their most serious face — we handle the rest.",
              },
              {
                step: "02",
                icon: "🎨",
                title: "We create the hero",
                body: "Our AI transforms them into a Pixar-style character and places them in every scene of the story.",
              },
              {
                step: "03",
                icon: "📬",
                title: "Preview, then order",
                body: "See every page of your personalized book for free. Love it? Order a premium hardcover — delivered to your door.",
              },
            ].map((s, i) => (
              <AnimatedSection key={i} delay={i * 0.12}>
                <div className="relative p-8 glass rounded-3xl h-full">
                  <div className="font-display text-7xl font-black text-ink/5 absolute top-4 right-6 select-none">
                    {s.step}
                  </div>
                  <div className="text-4xl mb-5">{s.icon}</div>
                  <h3 className="font-display font-semibold text-xl text-ink mb-3">{s.title}</h3>
                  <p className="text-ink/55 text-sm leading-relaxed">{s.body}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── Featured Books ───────────────────────────────────────────────────── */}
      {featured.length > 0 && (
        <section className="bg-cream py-24">
          <div className="max-w-6xl mx-auto px-6">
            <AnimatedSection className="flex items-end justify-between mb-12">
              <div>
                <h2 className="font-display text-4xl font-bold text-ink mb-2">
                  Choose your adventure
                </h2>
                <p className="text-ink/50">Tap a book to start your child&apos;s free preview.</p>
              </div>
              <Link href="/books" className="text-sm font-semibold text-brand-600 hover:text-brand-700 transition-colors shrink-0">
                See all books →
              </Link>
            </AnimatedSection>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {featured.map((story, i) => (
                <AnimatedSection key={story.id} delay={i * 0.1}>
                  <BookCard story={story} companyName={companyName} />
                </AnimatedSection>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Reviews ──────────────────────────────────────────────────────────── */}
      <section className="bg-white py-24">
        <div className="max-w-6xl mx-auto px-6">
          <AnimatedSection className="text-center mb-14">
            <div className="text-brand-500 text-2xl tracking-widest mb-3">★★★★★</div>
            <h2 className="font-display text-4xl font-bold text-ink mb-3">
              Parents love it. Kids obsess over it.
            </h2>
            <p className="text-ink/50">Real stories from real families.</p>
          </AnimatedSection>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {REVIEWS.map((r, i) => (
              <AnimatedSection key={i} delay={i * 0.1}>
                <div className="bg-cream rounded-3xl p-7 border border-ink/5 h-full flex flex-col">
                  <div className="text-brand-500 text-sm mb-4">★★★★★</div>
                  <p className="text-ink/80 text-sm leading-relaxed flex-1 italic">
                    &ldquo;{r.text}&rdquo;
                  </p>
                  <div className="flex items-center gap-3 mt-6">
                    <div className={`w-9 h-9 rounded-full ${r.color} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                      {r.initials}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-ink">{r.name}</div>
                      <div className="text-xs text-ink/40">{r.location}</div>
                    </div>
                  </div>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why Flipping Smiles ──────────────────────────────────────────────── */}
      <section className="bg-ink py-24">
        <div className="max-w-6xl mx-auto px-6">
          <AnimatedSection className="text-center mb-14">
            <h2 className="font-display text-4xl font-bold text-cream mb-3">
              Why families choose Flipping Smiles
            </h2>
            <p className="text-cream/40 text-lg max-w-lg mx-auto">
              We&apos;re not just making books. We&apos;re making memories.
            </p>
          </AnimatedSection>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {WHY.map((w, i) => (
              <AnimatedSection key={i} delay={i * 0.1}>
                <div className="glass-dark rounded-3xl p-7 hover:border-brand-400/50 transition-colors h-full">
                  <div className="text-3xl mb-4">{w.icon}</div>
                  <h3 className="font-display font-semibold text-cream text-lg mb-2">{w.title}</h3>
                  <p className="text-cream/40 text-sm leading-relaxed">{w.body}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQs ─────────────────────────────────────────────────────────────── */}
      <section className="bg-cream py-24">
        <div className="max-w-3xl mx-auto px-6">
          <AnimatedSection className="text-center mb-12">
            <h2 className="font-display text-4xl font-bold text-ink mb-3">
              Questions? We&apos;ve got answers.
            </h2>
          </AnimatedSection>
          <AnimatedSection>
            <FAQAccordion />
          </AnimatedSection>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────────── */}
      <section className="bg-brand-500 py-24">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <AnimatedSection>
            <Wordmark className="text-5xl text-white block mb-6" />
            <h2 className="font-display text-4xl sm:text-5xl font-bold text-white mb-5 leading-tight">
              Ready to make your child<br />the hero of the story?
            </h2>
            <p className="text-white/70 text-lg mb-10">
              Free preview in 30 seconds. No credit card required.
            </p>
            <Link
              href="/books"
              className="inline-flex items-center gap-2 bg-white text-brand-600 font-bold px-10 py-4 rounded-full text-lg hover:bg-brand-50 transition-all hover:scale-105 shadow-warm"
            >
              Try Now for Free →
            </Link>
          </AnimatedSection>
        </div>
      </section>
    </>
  );
}
