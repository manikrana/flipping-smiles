"use server";

import { getGemini, GEMINI_TEXT_MODEL } from "@/lib/gemini";

const PROMPT = `You are a children's book editor. Your task is to replace gendered pronouns in story text with template tokens so the same text works for any child.

Replace every gendered pronoun with the correct token:
- he / she → {{hero_he}}
- him / her (object) → {{hero_him}}
- his / her (possessive) → {{hero_his}}
- himself / herself → {{hero_himself}}

Rules:
- Only replace pronouns that refer to the main hero/protagonist (the personalised child character).
- Do NOT replace pronouns referring to other named characters (e.g. "the dragon flapped his wings" — leave that "his" alone unless the dragon is the hero).
- Do NOT change anything else: punctuation, capitalisation, sentence structure, {{hero_name}}, or any other existing tokens.
- Return only the updated story text, nothing else — no explanation, no markdown.

Story text to tokenize:
`;

export async function tokenizeStoryText(text: string): Promise<string> {
  const model = getGemini().getGenerativeModel({ model: GEMINI_TEXT_MODEL });
  const result = await model.generateContent(PROMPT + `"${text}"`);
  return result.response.text().trim().replace(/^"|"$/g, "");
}
