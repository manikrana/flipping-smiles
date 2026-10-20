import { createServerClient } from "@/lib/supabase/server";
import { signAssets, resolveStoragePath } from "@/lib/supabase/assets";
import { getCompanyName } from "@/lib/brand";
import { AnimatedSection } from "@/components/AnimatedSection";
import { BookCard } from "@/components/BookCard";

export const dynamic = "force-dynamic";

export default async function BooksPage() {
  const supabase = createServerClient();
  const [{ data: stories }, companyName] = await Promise.all([
    supabase
      .from("stories")
      .select("*")
      .eq("status", "ready")
      .eq("archived", false)
      .order("created_at", { ascending: false }),
    getCompanyName(),
  ]);

  const rawBooks = stories ?? [];

  // cover_image_url is a private storage path (or, for some older rows, a
  // legacy full URL from before the bucket went private) — resolve + sign it.
  const coverPaths = rawBooks
    .map((s) => (s.cover_image_url ? resolveStoragePath(s.cover_image_url) : null))
    .filter((p): p is string => !!p);
  const signedMap = await signAssets(supabase, coverPaths);
  const books = rawBooks.map((s) => ({
    ...s,
    cover_image_url: s.cover_image_url ? (signedMap[resolveStoragePath(s.cover_image_url)] ?? null) : null,
  }));

  return (
    <div className="pt-16 min-h-screen">
      {/* Header */}
      <section className="bg-cream py-20 border-b border-ink/5">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <AnimatedSection>
            <p className="text-sm font-semibold text-brand-600 uppercase tracking-widest mb-3">The Library</p>
            <h1 className="font-display text-5xl font-bold text-ink mb-4">
              Choose your child&apos;s story
            </h1>
            <p className="text-ink/50 text-lg max-w-xl mx-auto">
              Every book is personalized with your child&apos;s face, name, and pronouns. Tap a book to start a free preview.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* Grid */}
      <section className="relative py-20 bg-gradient-to-b from-brand-200 via-accent-200 to-cream overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full bg-brand-400/40 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 rounded-full bg-accent-400/35 blur-3xl pointer-events-none" />
        <div className="max-w-6xl mx-auto px-6">
          {books.length === 0 ? (
            <div className="text-center py-32">
              <div className="text-5xl mb-4">📚</div>
              <p className="text-ink/40 text-lg">New stories coming soon — check back shortly!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7">
              {books.map((story, i) => (
                <AnimatedSection key={story.id} delay={i * 0.08}>
                  <BookCard story={story} companyName={companyName} />
                </AnimatedSection>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
