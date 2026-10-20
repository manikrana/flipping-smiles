export const SKIN_TONES = ["light", "medium", "tan", "brown", "dark brown"] as const;
export const HAIR_COLORS = ["black", "brown", "dark brown", "blonde", "red", "auburn"] as const;
export const HAIR_STYLES = {
  boy: ["short and neat", "curly", "wavy", "buzz cut", "shaggy"],
  girl: ["long and straight", "curly", "wavy with a headband", "short bob", "two braids"],
} as const;
export const EYE_COLORS = ["brown", "dark brown", "hazel", "green", "blue"] as const;

export function getDefaultCharacterOptions() {
  return { skinTones: SKIN_TONES, hairColors: HAIR_COLORS, hairStyles: HAIR_STYLES, eyeColors: EYE_COLORS };
}
