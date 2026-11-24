// Full placeholder personalization for text actually SHOWN to the customer
// (live preview + PDF export) -- unlike personalizeSceneContext in orders/[id]/actions.ts (which
// deliberately substitutes the generic "the hero" for Gemini prompts), this
// puts the real hero_name in and also resolves the pronoun placeholders,
// which call sites used to skip entirely (a bare
// .replace(/{{hero_name}}/g, ...)), leaving any {{hero_he}}/{{hero_him}}/
// {{hero_his}}/{{hero_himself}} in the story text rendered completely
// literally to the customer, e.g. "Anika rolled {{hero_his}} eyes."
export function personalizeText(text: string, heroName: string, gender: "boy" | "girl"): string {
  const he = gender === "girl" ? "she" : "he";
  const him = gender === "girl" ? "her" : "him";
  const his = gender === "girl" ? "her" : "his";
  const himself = gender === "girl" ? "herself" : "himself";
  return text
    .replace(/{{hero_name}}/g, heroName)
    .replace(/{{hero_he}}/g, he)
    .replace(/{{hero_him}}/g, him)
    .replace(/{{hero_his}}/g, his)
    .replace(/{{hero_himself}}/g, himself);
}
