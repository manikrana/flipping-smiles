"use server";

import { getGemini, GEMINI_TEXT_MODEL } from "@/lib/gemini";
import { getStyle, DEFAULT_STYLE } from "@/lib/styles";

function buildInstruction(type: "character" | "scene", styleId?: string | null): string {
  const style = getStyle(styleId ?? DEFAULT_STYLE);

  if (type === "character") {
    return (
      `Rewrite the following as a highly specific visual description for an AI image generation model producing ${style.enhanceContext}. ` +
      `Rules:\n` +
      `- Use exact color names (e.g. "emerald green" not "green", "golden amber" not "yellow")\n` +
      `- Describe body proportions, size, and build\n` +
      `- List every distinctive feature: eyes, ears, horns, wings, markings, clothing, accessories\n` +
      `- Describe textures (smooth scales, fluffy fur, shiny shell, etc.)\n` +
      `- Output comma-separated descriptors in 1–2 sentences\n` +
      `- Do NOT add style keywords — only physical appearance\n` +
      `- Return only the rewritten description, no explanation\n\n` +
      `Examples of good output:\n` +
      `"small chubby emerald-green dragon, pale lime-yellow belly, round golden-amber eyes, two short ivory curved horns, tiny folded turquoise wings, stubby clawed feet, smooth iridescent scales with darker green ridge along spine"\n` +
      `"6-year-old boy, warm brown skin, large round hazel eyes, short wavy dark-brown hair, stocky build, wearing a cobalt-blue t-shirt, olive-green cargo shorts, white sneakers with red laces"`
    );
  }

  return (
    `Rewrite the following as a precise scene composition prompt for an AI image generation model producing ${style.enhanceContext}. ` +
    `Rules:\n` +
    `- Specify the shot type (e.g. wide shot, medium shot, close-up, over-the-shoulder)\n` +
    `- Describe character positions and actions clearly\n` +
    `- Include environment and setting details\n` +
    `- Mention lighting and time of day if relevant\n` +
    `- Do NOT describe character appearances — those are added separately\n` +
    `- Do NOT add style keywords — those are added automatically\n` +
    `- Output 1–2 sentences, return only the rewritten prompt, no explanation\n\n` +
    `Examples of good output:\n` +
    `"medium-wide shot, both characters facing each other on a sunlit forest path, dappled light filtering through tall oak trees, warm golden afternoon light, low camera angle looking up slightly"\n` +
    `"close-up shot of small character peering through a gap in dense green bushes, eyes wide with curiosity, shallow depth of field, soft diffused light from the left"`
  );
}

export async function enhancePrompt(
  type: "character" | "scene",
  currentValue: string,
  styleId?: string | null
): Promise<string> {
  const model = getGemini().getGenerativeModel({ model: GEMINI_TEXT_MODEL });
  const instruction = buildInstruction(type, styleId);
  const result = await model.generateContent(
    `${instruction}\n\nInput to enhance:\n"${currentValue}"`
  );
  return result.response.text().trim().replace(/^["']|["']$/g, "");
}
