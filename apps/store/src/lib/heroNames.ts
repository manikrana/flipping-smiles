// Placeholder hero names shown on customer-facing book thumbnails/covers
// before a real customer name is known (browsing pages -- nobody has entered
// a child's name yet at that point). {{hero_name}} as literal text reads as
// a bug to a customer, so we swap in one of these instead. Gendered so the
// name always matches which cover variant is actually being shown
// (cover_image_url = boy, cover_image_url_girl = girl).
//
// Deterministic per story (hashed from the story id) rather than randomized
// on every render, so the same book shows the same name on every page load
// instead of flickering between names.
//
// TODO (deferred, explicitly out of scope for now): once a customer enters
// their child's photo/name/gender during personalization, remember it (e.g.
// via a cookie) and show that real name everywhere instead of a default,
// with the resulting personalized cover image cached so switching between
// books doesn't require regenerating on every view.
const BOY_HERO_NAMES = ["Kai", "Arjun", "Rohan", "Vihaan", "Arnav"];
const GIRL_HERO_NAMES = ["Maya", "Nora", "Aria", "Diya", "Ananya"];

export function pickDefaultHeroName(seed: string, gender: "boy" | "girl" = "boy"): string {
  const names = gender === "girl" ? GIRL_HERO_NAMES : BOY_HERO_NAMES;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return names[Math.abs(hash) % names.length];
}

// Per-book sample name (stories.sample_hero_name, e.g. a gender-neutral
// "Alex") wins over the hashed list above, so a book can pick a name that
// fits its look on both the boy and girl covers. Stories read with select("*")
// simply have it undefined until the migration runs, and fall back to the list.
export function sampleHeroName(
  story: { id: string; sample_hero_name?: string | null },
  gender: "boy" | "girl" = "boy"
): string {
  return story.sample_hero_name?.trim() || pickDefaultHeroName(story.id, gender);
}

// Titles can carry the name too ("{{hero_name}} and the Night of Christmas
// Magic"), not just the subtitle; customers must never see the raw token.
export function fillHeroName(text: string, name: string): string {
  return text.replace(/{{hero_name}}/g, name);
}
