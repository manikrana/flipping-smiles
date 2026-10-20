"use server";

import { createServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getGemini, NANO_BANANA_2_MODEL, extractImageBuffer, generateCharacterSheetBuffer, generateHeadSheetBuffer, GeminiNoImageError } from "@/lib/gemini";
import { logGeminiCall } from "@/lib/geminiLog";
import { trackServer } from "@/lib/track-server";
import { cartoonizeRatelimit, CARTOONIZE_MAX_ATTEMPTS } from "@/lib/ratelimit";
import { headers } from "next/headers";
import { getOrCreateCartId } from "@/lib/cart";

export async function cartoonize(formData: FormData): Promise<{ cartoonUrl: string; characterId: string }> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? "anonymous";
  const { success, remaining } = await cartoonizeRatelimit.limit(ip);
  if (!success) throw new Error(`Too many requests — you can cartoonize ${CARTOONIZE_MAX_ATTEMPTS} photos per hour. Please try again later.`);

  trackServer("cartoonize_started");
  const supabase = createServerClient();

  const photo = formData.get("photo") as File | null;
  const heroName = formData.get("hero_name") as string;
  const gender = formData.get("gender") as string;

  if (!photo || photo.size === 0) throw new Error("Please upload a photo.");
  if (!photo.type.startsWith("image/")) throw new Error("Please upload a valid image file.");
  if (photo.size > 10 * 1024 * 1024) throw new Error("Photo must be under 10MB.");

  const arrayBuffer = await photo.arrayBuffer();

  const { data: character, error: charError } = await supabase
    .from("characters")
    .insert({
      source_image_url: null,
      hero_name: heroName || "Hero",
      generation_status: "processing",
      cartoon_image_url: null,
      replicate_job_id: null,
      is_default: false,
      default_gender: null,
    })
    .select("id")
    .single();
  if (charError) throw new Error(charError.message);

  const photoBase64 = Buffer.from(arrayBuffer).toString("base64");
  const headshotModel = getGemini().getGenerativeModel({
    model: NANO_BANANA_2_MODEL,
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] } as never,
  });

  const photoInlineData = { inlineData: { data: photoBase64, mimeType: photo.type } };

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
    photoInlineData,
    { text: "Generate the Pixar 3D character portrait of this exact child:" },
    photoInlineData,
  ]);


  // Gemini's IMAGE_SAFETY classifier intermittently blocks ordinary child
  // photos (confirmed: the same photo passes and fails back to back with an
  // identical prompt), so a block is retried -- ONLY that failure; every
  // other error fails immediately. A failed generation used to leave the
  // character stuck in "processing" with no trace of why, so the real reason
  // is also recorded on the row and as an analytics event.
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
      trackServer("cartoonize_safety_retry", { properties: { character_id: character.id, attempt } });
    }
  }
  if (!cartoonBuffer) {
    const reason = lastError instanceof GeminiNoImageError ? lastError.finishReason : `error: ${(lastError as Error).message.slice(0, 120)}`;
    await supabase.from("characters").update({ generation_status: "failed" }).eq("id", character.id);
    trackServer("cartoonize_failed", { properties: { character_id: character.id, reason } });
    throw lastError;
  }
  await logGeminiCall(supabase, { callType: "character_cartoon" });
  const cartoonPath = `characters/${character.id}/cartoon-${Date.now()}.png`;
  const { error: cartoonUploadError } = await supabase.storage
    .from("assets")
    .upload(cartoonPath, cartoonBuffer, { contentType: "image/png", upsert: true });
  if (cartoonUploadError) throw new Error(`Cartoon upload failed: ${cartoonUploadError.message}`);

  await supabase
    .from("characters")
    .update({ cartoon_image_url: cartoonPath, generation_status: "done" })
    .eq("id", character.id);

  trackServer("cartoonize_completed", { properties: { character_id: character.id } });

  // Signed once, reused both for the client's immediate preview and for the
  // background sheet generation below (1hr TTL — plenty for a job that runs
  // within seconds of this request).
  const { data: signed } = await supabase.storage.from("assets").createSignedUrl(cartoonPath, 3600);

  // The character sheet (4-panel turnaround, used for consistency across
  // scenes) took ~19s on its own in testing -- combined with the ~8s
  // headshot call, the full synchronous flow ran ~27s, uncomfortably close
  // to common gateway/proxy timeouts and the likely cause of the "something
  // went wrong" reports on the deployed site. The sheet isn't needed until
  // actual scene generation (generateScene() already falls back to
  // cartoon_image_url when sheet_url is null), so it doesn't need to block
  // the response the user is waiting on.
  after(async () => {
    // Body sheet and head turnaround are independent artifacts -- one failing
    // must not lose the other, and each is non-fatal on its own (the
    // character is already usable via cartoon_image_url; order generation
    // lazily creates whichever is missing).
    const bodySheet = async () => {
      if (!signed?.signedUrl) throw new Error("Failed to sign cartoon URL for sheet generation");
      const sheetBuffer = await generateCharacterSheetBuffer(signed.signedUrl);
      await logGeminiCall(supabase, { callType: "character_sheet" });
      const sheetPath = `characters/${character.id}/sheet-${Date.now()}.png`;
      const { error: sheetUploadError } = await supabase.storage
        .from("assets")
        .upload(sheetPath, sheetBuffer, { contentType: "image/png", upsert: true });
      if (sheetUploadError) throw new Error(`Sheet upload failed: ${sheetUploadError.message}`);

      await supabase
        .from("characters")
        .update({ sheet_url: sheetPath })
        .eq("id", character.id);
    };

    const headSheet = async () => {
      if (!signed?.signedUrl) throw new Error("Failed to sign cartoon URL for head sheet generation");
      // Skip (don't pay for a result that can't be saved) if the
      // head_sheet_url column isn't there yet -- migration 0069 not applied.
      const { error: probeError } = await supabase.from("characters").select("head_sheet_url").limit(1);
      if (probeError) throw new Error(`head_sheet_url column unavailable, skipping (${probeError.message})`);
      const headBuffer = await generateHeadSheetBuffer(signed.signedUrl);
      await logGeminiCall(supabase, { callType: "character_head_sheet" });
      const headPath = `characters/${character.id}/head-sheet-${Date.now()}.png`;
      const { error: headUploadError } = await supabase.storage
        .from("assets")
        .upload(headPath, headBuffer, { contentType: "image/png", upsert: true });
      if (headUploadError) throw new Error(`Head sheet upload failed: ${headUploadError.message}`);

      const { error: headUpdateError } = await supabase
        .from("characters")
        .update({ head_sheet_url: headPath })
        .eq("id", character.id);
      if (headUpdateError) throw new Error(`Head sheet save failed: ${headUpdateError.message}`);
    };

    const [body, head] = await Promise.allSettled([bodySheet(), headSheet()]);
    if (body.status === "rejected") console.error("[cartoonize] background sheet generation failed:", (body.reason as Error).message);
    if (head.status === "rejected") console.error("[cartoonize] background head sheet generation failed:", (head.reason as Error).message);
  });

  return { cartoonUrl: signed?.signedUrl ?? "", characterId: character.id };
}

export async function placeOrder(formData: FormData) {
  const supabase = createServerClient();

  const storyId = formData.get("story_id") as string;
  const heroName = formData.get("hero_name") as string;
  const gender = (formData.get("gender") as string) === "girl" ? "girl" : "boy";
  const language = formData.get("language") as string;
  const age = parseInt(formData.get("age") as string, 10) || null;
  const photo = formData.get("photo") as File | null;
  const amountUsd = formData.get("amount_usd") as string;
  const consent = formData.get("consent");
  const useDefaultCharacter = (formData.get("character_source") as string) === "default";

  if (!storyId || !heroName || !language) {
    throw new Error("All fields are required.");
  }

  let characterId: string;

  if (useDefaultCharacter) {
    const selectedCharacterId = formData.get("character_id") as string | null;
    if (!selectedCharacterId) {
      throw new Error("Please choose a character.");
    }

    const { data: defaultCharacter, error: defaultError } = await supabase
      .from("characters")
      .select("id")
      .eq("id", selectedCharacterId)
      .eq("is_default", true)
      .eq("default_gender", gender)
      .single();

    if (defaultError || !defaultCharacter) {
      throw new Error("That character is no longer available — please choose another.");
    }

    characterId = defaultCharacter.id;
  } else {
    if (consent !== "on") {
      throw new Error("Please confirm you are the child's parent or legal guardian.");
    }

    const existingCharacterId = formData.get("character_id") as string | null;
    if (!existingCharacterId) {
      throw new Error("Please cartoonize your photo first.");
    }

    characterId = existingCharacterId;
  }

  const cartId = await getOrCreateCartId();

  // Create order record
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      story_id: storyId,
      character_id: characterId,
      language,
      hero_name: heroName,
      gender,
      status: "pending_payment",
      shipping_address: {},
      child_age: age,
      amount_usd: parseFloat(amountUsd),
      stripe_payment_intent_id: null,
      pdf_url: null,
      cart_id: cartId,
    })
    .select("id")
    .single();

  if (orderError) throw new Error(orderError.message);

  redirect(`/orders/${order.id}`);
}
