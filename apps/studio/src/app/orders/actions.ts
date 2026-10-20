"use server";

import { createServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getGemini, NANO_BANANA_2_MODEL, urlToInlineData, extractImageBuffer, generateCharacterSheetBuffer, GeminiNoImageError } from "@/lib/gemini";
import { sendAdminNewOrderNotification } from "@/lib/email";
import { logGeminiCall } from "@/lib/geminiLog";
// Note: sourceImageUrl in startCharacterGeneration is a signed URL passed from the caller (already signed)

export async function startCharacterGeneration(characterId: string, sourceImageUrl: string) {
  const supabase = createServerClient();

  await supabase
    .from("characters")
    .update({ generation_status: "processing" })
    .eq("id", characterId);

  try {
    // ── Step 1: Convert photo to Pixar cartoon headshot ───────────────────────
    const photoData = await urlToInlineData(sourceImageUrl, "image/jpeg");
    const headshotModel = getGemini().getGenerativeModel({
      model: NANO_BANANA_2_MODEL,
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] } as never,
    });

    const generate = () => headshotModel.generateContent([
      {
        text: `PRIMARY OBJECTIVE:
Create a Pixar-quality 3D animated character portrait while preserving the child's identity with maximum fidelity.

If there is any conflict between stylization and likeness, likeness must win.

IDENTITY PRESERVATION:
Treat the uploaded photo as the sole character reference.

Preserve:
- facial geometry
- facial proportions
- feature placement
- skin tone and undertone
- hair color EXACTLY as photographed (dark brown is not black; keep any reddish, warm, or lighter highlights or sun-lightened strands -- never default to jet black), plus hair texture, length, part, and hairline
- eye shape, spacing, and color
- nose shape
- lip shape
- ears
- all unique traits, asymmetries, freckles, dimples, birthmarks, and facial characteristics
- visible accessories exactly as worn: earrings, glasses, hair clips, headbands
- the exact facial expression from the photo: same smile width and teeth visibility (or lack of), same mouth shape, same eyebrow position. Do not swap in a generic pleasant expression.

The child must remain immediately recognizable to family members.

SKIN TONE AND COMPLEXION — CRITICAL:
Match the child's true complexion: the same depth (lightness/darkness), warmth, and undertone as in the reference photo. Judge it from the well-lit midtones of the cheeks and forehead -- NOT from shadowed areas, and NOT from any colored ambient light or colored background tint in the photo (e.g. pink, blue, or purple room lighting). Reproduce that same overall brightness in the render: the face must not come out darker or deeper than the photo, and must not come out lighter or paler than the photo. Both errors are equally unacceptable.
If the photo is bright, flash-lit, or close to overexposed, do NOT treat that brightness as blown-out highlights to be corrected downward: a bright photo of a light or light-medium complexion must produce a light or light-medium complexion in the render. Never tan, bronze, or deepen the skin to look more "animated" or richer. A fair or light-medium child must stay fair or light-medium.
Do not apply an idealized or generic "animated character" skin tone. The output must match the source complexion as closely as a color-accurate render allows.

Do not:
- beautify
- idealize
- symmetrize
- age up or age down
- alter ethnicity
- alter hairstyle
- shift skin tone in either direction (no lightening, whitening, brightening, darkening, tanning, bronzing, or deepening)
- invent features

STYLE:
Target roughly 3-4 out of 10 on a photo-to-cartoon stylization scale, where 0 is the unedited photograph and 10 is a fully abstracted, exaggerated cartoon character. This should read as a lightly stylized 3D render of the actual child, not an original character design "inspired by" them -- a parent should think "that's a 3D photo of my kid," not "that's a cartoon that looks like my kid."
Keep the real face shape, proportions, and bone structure essentially unchanged from the photo.
Premium Pixar-quality 3D rendering and shading with detailed hair rendering and polished render quality. LIGHTING: soft, even, neutral studio lighting on the face -- do not use warm or dramatic cinematic lighting, and do not add deeper shadows, extra contrast, or a darker overall exposure than the photo.
EYES -- strict limit: enlarge the eyes by no more than about 10% compared to their actual size in the photo -- barely perceptible, just enough for a touch of animated warmth and a slight catchlight sparkle. Do NOT make the eyes noticeably rounder, bigger, or more wide-open than in the photo. Keep the exact eye shape (including any almond shape, narrowing, or lid shape), spacing, iris-to-white ratio, and eyelid position from the photo.
Keep real skin texture and natural variation -- do not smooth skin into a flat, toy-like, airbrushed surface. This is a believable 3D render of a real child, not a flat illustration.

COMPOSITION:
Top of head to mid-chest.
Face occupies approximately 60% of image height.
Centered composition.
Same pose, camera angle, and facial expression as source image.
Plain white background, regardless of the photo's original background.

CONSISTENCY:
Create a reusable storybook character model suitable for maintaining visual consistency across future scenes.

NEGATIVE PROMPT:
Generic Pixar face, anime features, beauty retouching, altered nose, altered hairstyle, jet-black hair when the photo shows dark brown or highlighted hair, different ethnicity, enlarged forehead, altered facial expression, generic pleasant expression not matching the photo, adult facial proportions, darker skin than the photo, tanned or bronzed skin, deeper or darker complexion than the photo, lighter skin than the photo, paler or whitened complexion, washed-out complexion, color cast from the photo's ambient lighting, generic animated-character skin tone, dramatic or warm cinematic lighting, heavy shadows on the face, over-stylized cartoon proportions, exaggerated features, flat illustration-style rendering, flat toy-like skin texture, generic oversized cartoon eyes, noticeably enlarged eyes, round doe eyes, heavily altered eyes, photo background.`,
      },
      photoData,
      { text: "Generate the Pixar 3D character portrait of this exact child:" },
      photoData,
    ]);

    // Gemini's IMAGE_SAFETY classifier intermittently blocks ordinary child
    // photos (the same photo passes and fails back to back with an identical
    // prompt), so a block is retried -- ONLY that failure; any other error
    // falls through to the outer catch immediately.
    const MAX_SAFETY_ATTEMPTS = 3;
    let cartoonBuffer: Buffer | null = null;
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_SAFETY_ATTEMPTS; attempt++) {
      try {
        const { response } = await generate();
        cartoonBuffer = extractImageBuffer(response);
        break;
      } catch (err) {
        lastError = err;
        const isSafetyBlock = err instanceof GeminiNoImageError && err.finishReason === "IMAGE_SAFETY";
        if (!isSafetyBlock || attempt === MAX_SAFETY_ATTEMPTS) break;
        console.warn(`[cartoonize] IMAGE_SAFETY block, retrying (attempt ${attempt}/${MAX_SAFETY_ATTEMPTS})`);
      }
    }
    if (!cartoonBuffer) throw lastError;
    await logGeminiCall(supabase, { callType: "character_cartoon" });
    const cartoonPath = `characters/${characterId}/cartoon-${Date.now()}.png`;
    const { error: cartoonUploadError } = await supabase.storage
      .from("assets")
      .upload(cartoonPath, cartoonBuffer, { contentType: "image/png", upsert: true });
    if (cartoonUploadError) throw new Error(`Cartoon upload failed: ${cartoonUploadError.message}`);

    await supabase
      .from("characters")
      .update({ cartoon_image_url: cartoonPath })
      .eq("id", characterId);

    // ── Step 2: Generate 4-view character sheet from the cartoon headshot ─────
    const { data: cartoonSigned } = await supabase.storage.from("assets").createSignedUrl(cartoonPath, 3600);
    if (!cartoonSigned?.signedUrl) throw new Error("Failed to sign cartoon URL for sheet generation");
    const sheetBuffer = await generateCharacterSheetBuffer(cartoonSigned.signedUrl);
    await logGeminiCall(supabase, { callType: "character_sheet" });
    const sheetPath = `characters/${characterId}/sheet-${Date.now()}.png`;
    const { error: sheetUploadError } = await supabase.storage
      .from("assets")
      .upload(sheetPath, sheetBuffer, { contentType: "image/png", upsert: true });
    if (sheetUploadError) throw new Error(`Sheet upload failed: ${sheetUploadError.message}`);

    await supabase
      .from("characters")
      .update({ sheet_url: sheetPath, generation_status: "done" })
      .eq("id", characterId);

  } catch (err) {
    await supabase
      .from("characters")
      .update({ generation_status: "failed" })
      .eq("id", characterId);
    throw err;
  }

  revalidatePath("/orders");
  revalidatePath("/default-characters");
}

// Kept for backwards compatibility with any in-flight Replicate jobs
export async function checkCharacterStatus(_characterId: string, _jobId: string): Promise<"done" | "failed" | "processing"> {
  return "failed";
}


export async function confirmPayment(orderId: string) {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("orders")
    .update({ status: "paid" })
    .eq("id", orderId)
    .eq("status", "payment_submitted");
  if (error) throw new Error(error.message);
  revalidatePath("/orders");

  // Fire admin notification — non-blocking, don't let email failure break the action
  try {
    const { data: order } = await supabase
      .from("orders")
      .select("hero_name, stories ( title ), characters ( cartoon_image_url, generation_status, is_default )")
      .eq("id", orderId)
      .single() as unknown as { data: { hero_name: string; stories: { title: string } | null; characters: { cartoon_image_url: string | null; generation_status: string; is_default: boolean } | null } | null };

    if (order) {
      const story = order.stories;
      const character = order.characters;
      const cartoonReady = !!(character?.is_default || (character?.cartoon_image_url && character.generation_status === "done"));
      await sendAdminNewOrderNotification({
        orderId,
        heroName: order.hero_name,
        bookTitle: story?.title ?? "Unknown book",
        cartoonReady,
      });
    }
  } catch (emailErr) {
    console.error("[confirmPayment] email notification failed:", emailErr);
  }
}
