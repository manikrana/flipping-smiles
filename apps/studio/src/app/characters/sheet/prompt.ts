/**
 * Character sheet prompt builder.
 *
 * IMPORTANT: gemini-2.5-flash-image does not reliably honor systemInstruction
 * for image generation. All critical constraints (style, layout, background,
 * scale) must be in the USER PARTS, not the system instruction.
 *
 * buildSystemInstruction() — minimal persona only (low weight anyway)
 * buildUserParts()         — all constraints + character content
 */

export function buildSystemInstruction(): string {
  return `You are a professional character sheet artist for children's picture books. You produce precise, standardized character reference sheets for use in story illustration.`;
}

/**
 * Builds the full ordered user parts array for a character sheet generation.
 *
 * Part order:
 *  1. REQUIRED SPECIFICATIONS  — style, layout, background, scale, labels (read first, highest weight)
 *  2. IDENTITY REFERENCE image — clones only
 *  3. IDENTITY LOCK rules      — clones only
 *  4. CHARACTER                — name + description
 *  5. TASK                     — explicit generation instruction + generation token
 */
export function buildSheetUserParts(params: {
  characterName: string;
  characterDescription: string;
  styleInstruction: string;
  isClone: boolean;
  primaryName?: string | null;
  generationToken: string;
}): string[] {
  const { characterName, characterDescription, styleInstruction, isClone, primaryName, generationToken } = params;
  const nameUpper = characterName.toUpperCase();

  const parts: string[] = [];

  // ── Part 1: Required specifications ──────────────────────────────────────
  // These go FIRST so the model reads them before any character content.
  parts.push(
    [
      `════════════════════════════════════════`,
      `REQUIRED SPECIFICATIONS — follow exactly`,
      `════════════════════════════════════════`,
      ``,
      `ART STYLE (mandatory):`,
      `  Render in: ${styleInstruction}`,
      `  This means: glossy smooth 3D surfaces, subsurface scattering on skin,`,
      `  large expressive eyes, vibrant saturated colors, warm soft studio lighting,`,
      `  polished CGI quality — identical to a Pixar or Disney 3D animated feature film.`,
      `  ⚠️ DO NOT render in 2D, flat, cel-shaded, painted, sketch, or anime style.`,
      ``,
      `LAYOUT (mandatory):`,
      `  ONE SINGLE WIDE HORIZONTAL IMAGE — NOT a 2×2 grid.`,
      `  Four equal panels in a single row, left to right:`,
      ``,
      `  ┌──────────┬──────────┬──────────┬──────────┐`,
      `  │  FRONT   │   3/4    │   SIDE   │   BACK   │`,
      `  └──────────┴──────────┴──────────┴──────────┘`,
      ``,
      `  Panel 1 — FRONT : faces directly toward viewer, arms relaxed at sides`,
      `  Panel 2 — 3/4   : 45° angle to the right, showing depth`,
      `  Panel 3 — SIDE  : right profile, full body`,
      `  Panel 4 — BACK  : facing directly away, full body`,
      `  The image is wider than it is tall. All panels are equal size.`,
      ``,
      `BACKGROUND (mandatory):`,
      `  Uniform flat mid-grey: #808080`,
      `  No gradients. No ground shadow. No decorative frames or borders.`,
      `  No environment. No props. Pure flat grey from edge to edge.`,
      ``,
      `SCALE (mandatory):`,
      `  Character fills 80% of each panel's height.`,
      `  Equal grey space above head and below feet.`,
      `  Same scale in all four panels — same height in every panel.`,
      `  Never crop any body part. Full figure head to feet always visible.`,
      ``,
      `LABELS (mandatory):`,
      `  Header: dark bar spanning full width at top, bold white text: "${nameUpper}"`,
      `  Panel footers: FRONT  |  3/4  |  SIDE  |  BACK`,
      ``,
      `CONSISTENCY (mandatory):`,
      `  Identical character across all panels — same face, hair, clothing, colors.`,
      `  Only the viewing angle changes between panels.`,
      `  Every accessory (crown, tiara, earrings, necklaces, waist belt, anklets, footwear, rings, bangles)`,
      `  must appear in ALL FOUR panels. Do not omit any item from any viewing angle.`,
    ].join(`\n`)
  );

  // ── Part 3: Character ─────────────────────────────────────────────────────
  parts.push(
    [
      `════════════════════════════════════════`,
      `CHARACTER`,
      `════════════════════════════════════════`,
      `Name: ${characterName}`,
      ``,
      `Description:`,
      characterDescription,
    ].join(`\n`)
  );

  // ── Part 4: Task ──────────────────────────────────────────────────────────
  parts.push(
    [
      `════════════════════════════════════════`,
      `TASK`,
      `════════════════════════════════════════`,
      isClone
        ? `Generate a 4-panel character sheet for "${characterName}".`
        : `Generate a 4-panel character sheet for the character described above.`,
      ``,
      isClone
        ? [
            `Use the FACE, HAIR, SKIN TONE, and BODY TYPE from the identity reference image.`,
            `ALL clothing, footwear, and accessories from the reference are REMOVED and REPLACED with the new costume described above.`,
            ``,
            `⚠️ FOOTWEAR IS MANDATORY: The footwear described in the CHARACTER section must be rendered exactly.`,
            `Do NOT use the footwear from the reference image. Render new footwear precisely as described.`,
            ``,
            `⚠️ ACCESSORY CONSISTENCY: Every accessory named in the CHARACTER description`,
            `(crown, tiara, earrings, necklaces, waist belt, anklets, rings, bangles, armlets)`,
            `must appear visibly in ALL FOUR panels — front, 3/4, side, and back.`,
            `Check every panel before finalising. Do not drop any accessory from any angle.`,
          ].join(`\n`)
        : `Render the character exactly as described above.`,
      ``,
      `CRITICAL REMINDERS:`,
      `  • Pixar/Disney 3D CGI style — not 2D or flat`,
      `  • Single horizontal row of 4 panels — not a 2×2 grid`,
      `  • Plain grey background #808080 — no decorative frames or gradients`,
      `  • Header label: "${nameUpper}"`,
      ``,
      `[token:${generationToken}]`,
    ].join(`\n`)
  );

  return parts;
}

/**
 * Builds the IDENTITY LOCK text part for clones (inserted between
 * the reference image and the CHARACTER section).
 */
export function buildIdentityLockPart(primaryName: string | null): string {
  return [
    `════════════════════════════════════════`,
    `IDENTITY REFERENCE (image directly above)`,
    `════════════════════════════════════════`,
    `The image above shows the primary character "${primaryName ?? "the primary character"}".`,
    `This is a COSTUME CHANGE — same person, entirely new outfit.`,
    ``,
    `COPY ONLY these elements — nothing else:`,
    `  • Face shape and all facial features`,
    `  • Skin tone`,
    `  • Eye color, shape, and size`,
    `  • Hair: color, texture, length, and style`,
    `  • Body type, build, and proportions`,
    `  • Age and overall identity`,
    ``,
    `COMPLETELY REMOVE and REPLACE everything else — carry nothing forward:`,
    `  • ALL clothing: the entire outfit (sari, blouse, dress, top, skirt, pants — everything)`,
    `  • ALL footwear: shoes, sandals, slippers — do not reuse the reference footwear under any circumstances`,
    `  • ALL jewellery: earrings, necklaces, bangles, rings, anklets, armlets`,
    `  • ALL head accessories: crowns, tiaras, flowers, clips`,
    `  • ALL waist items: belts, ropes, sashes, chains`,
    `  • ALL bags, pouches, or carried objects`,
    ``,
    `The character wears ONLY what is described in the CHARACTER section below.`,
    `If an item is not described below, it does not exist on this character.`,
    `Nothing from the reference image's costume should appear in the output.`,
  ].join(`\n`);
}
