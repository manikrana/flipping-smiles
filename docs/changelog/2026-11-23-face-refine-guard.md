# Face refine: post-redraw guard against "floating heads"

**What happened.** An order preview (spread 1 of the Christmas book) shipped with the hero's head floating on its own white collar and bow, stacked above the body's real collar and bow.

**Cause.** The face-refine pass runs *after* every judge (identity, wardrobe, scene preservation, single hero, text zone). It crops the head, has Gemini redraw it, then feathers it back in. That redraw moved and shrank the head inside the crop and drew a collar under it. The feathered mask reached below the chin, so the redrawn collar was pasted over the body. No check ran after this step.

**Fix** (`apps/store/src/lib/faceRefine.ts`, mirrored in `apps/studio/src/lib/faceRefine.ts`):
- Every redraw is compared with the original close-up in one text-only Gemini call before it is pasted. The call returns the head box (rejected if the centre moved more than 7% of the crop, or the head height changed outside x0.85 to x1.18) and an anatomy verdict (detached or floating head, doubled collar, neck or chin).
- A failed check retries the redraw once. If that also fails, the unrefined fill-in ships. It has already passed every judge.
- The feather mask is shorter at the bottom, so it ends around the chin and never replaces the body's own neck or collar.

**Cost.** One extra text call per redraw, at about $0.0004 (logged under the detect call type), plus at most one extra redraw when a check fails.

**Rollback.** Revert this commit. `FACE_REFINE=off` still disables the whole pass.
