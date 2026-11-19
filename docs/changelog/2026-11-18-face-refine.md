# 2026-11-18: Second-pass face refinement on order pages

**Branch:** `orders/face-refine-pass`

**Why:** The cartoon portrait made from the customer's photo was a close likeness, but the face drifted once the hero was swapped into a spread (taller hair, slimmer and older face). The swap repaints the whole spread, and the face is a small part of it, so fine likeness details get lost.

**What changed:**

| Where | Change |
|---|---|
| `apps/studio/src/lib/faceRefine.ts`, `apps/store/src/lib/faceRefine.ts` (identical copies) | New `refineHeroFace()`: finds the hero's head in the finished swap, crops it square with margin, enlarges it to 1024px, has Gemini redraw only the face and hair with the portrait (and head turnaround) as reference, then blends it back with a soft elliptical mask. Everything outside the mask stays pixel-identical. |
| `apps/studio/src/app/orders/generate/actions.ts` | Runs the pass on the final swap before upload, for pages and covers, on both the verified path and the best-of-retries path. |
| `apps/store/src/app/orders/[id]/actions.ts` | Same for store preview pages. |
| `apps/*/src/lib/geminiLog.ts`, `geminiPricing.ts` | New call types `order_face_detect_*` (~$0.0004) and `order_face_refine_*` (~$0.07). |
| `apps/store/package.json`, `pnpm-lock.yaml` | Adds `sharp` to the store (the studio already had it). |

**Safety:** if anything fails (no head found, a box that's too big or too small, a Gemini refusal, bad output), the original swap is kept unchanged. The pass never blocks an order.

**Cost:** about +$0.07 per page per order (one detection call plus one 1:1 redraw).

**How to turn it off (no code change):** add `FACE_REFINE=off` to `apps/studio/.env.local` and `apps/store/.env.local` (and to the deployed environments), then restart `pnpm dev`.

**How to roll back the code:**

```
cd ~/Documents/Projects/flipping-smiles
git log --oneline --grep "face refinement"
git revert <that commit>
git push origin main
```

Then run `pnpm install` (removes the store's sharp link) and restart `pnpm dev`.
