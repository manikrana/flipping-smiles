"use server";

import { getGemini, GEMINI_TEXT_MODEL } from "@/lib/gemini";

const PROMPT = `You are a children's book editor. Given a list of story page texts, extract all named supporting characters — characters other than the main hero (referred to as {{hero_name}}).

Rules:
- Only extract proper character names (e.g. "Zara", "Captain Leo", "Grandma Rose", "the Dragon King")
- Do NOT include the main hero ({{hero_name}} or generic "the child" references)
- Do NOT include locations, objects, or unnamed roles ("the tree", "a stranger", "the crowd")
- Prefer the character's full or most descriptive name as used in the text
- If a character appears multiple times with variations, return the clearest version once
- Return a JSON array of strings, nothing else — no explanation, no markdown fences

Example output: ["Zara the Brave", "Captain Leo", "Grandma Rose"]

Story pages:
`;

export async function detectCharacters(pageTexts: string[]): Promise<string[]> {
  const combined = pageTexts
    .filter((t) => t.trim())
    .map((t, i) => `Page ${i + 1}: ${t}`)
    .join("\n\n");

  if (!combined) return [];

  const model = getGemini().getGenerativeModel({ model: GEMINI_TEXT_MODEL });
  const result = await model.generateContent(PROMPT + combined);
  const text = result.response.text().trim();

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.filter((s) => typeof s === "string");
  } catch {
    // Try to extract array from response if extra text crept in
    const match = text.match(/\[.*\]/s);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) return parsed.filter((s) => typeof s === "string");
      } catch { /* ignore */ }
    }
  }

  return [];
}
