export type GenerationStyle = "pixar-3d";

export const DEFAULT_STYLE: GenerationStyle = "pixar-3d";

interface StyleConfig {
  label: string;
  description: string;
  // Gemini system instruction fragment for scene generation
  sceneStyleInstruction: string;
  // Flux prompt prefix
  fluxPromptPrefix: string;
  // Gemini system instruction fragment for character/hero sheet generation
  sheetStyleInstruction: string;
  // Context line used inside Enhance prompt instructions
  enhanceContext: string;
}

export const STYLES: Record<GenerationStyle, StyleConfig> = {
  "pixar-3d": {
    label: "Pixar 3D",
    description: "Vibrant, warm 3D animation — like a Pixar film",
    sceneStyleInstruction:
      "Pixar 3D animated movie style — vibrant, warm, polished, child-friendly",
    fluxPromptPrefix:
      "Pixar 3D animated movie style, children's storybook illustration",
    sheetStyleInstruction:
      "Pixar 3D animated movie style — vibrant, polished, child-friendly",
    enhanceContext:
      "Pixar-style 3D animated children's book illustrations",
  },
};

export function getStyle(id: string | null | undefined): StyleConfig {
  return STYLES[(id as GenerationStyle) ?? DEFAULT_STYLE] ?? STYLES[DEFAULT_STYLE];
}
