# Studio change log

Changes to how the studio generates book pages, with what changed, why, and how to undo each one. Newest first.

## 2026-11-17: Spread scenes use a medium shot with a large foreground hero

**Commit:** `553e50e` (branch `studio/hero-framing-medium-shot`)
**File:** `apps/studio/src/app/stories/backgrounds/approve/actions.ts` (`generateSpreadScene`)

**Why:** The wrapper around every spread prompt asked Gemini for a "panoramic", "wide-angle" shot. That overrode page prompts asking for a bigger hero, so the white silhouette came out small (about a third of the image height). A small face loses likeness when the child's avatar is swapped in.

**What changed:**

| Part | Before | After |
|---|---|---|
| Bleed layout camera line | "Render this as a single wide-angle shot. The camera is at ground level, looking across the scene at eye height." / "...as if photographed with one wide lens." | "Render this as a single continuous medium shot. The camera is at eye height, looking into the scene." / "...as if photographed with one lens." |
| Clean-scene opening line | "Create one continuous panoramic children's storybook illustration, rendered from a single wide-angle virtual camera in 16:9 widescreen landscape..." | "Create one continuous children's storybook illustration in 16:9 widescreen landscape, framed as a medium shot from a single virtual camera..." |
| Clean-scene composition | "...in the ${SCENE_HALF} portion of the panorama..." | "...in the ${SCENE_HALF} portion of the image..." |
| New section (both layouts), before CHARACTERS | none | HERO FRAMING: unless the scene calls for a distant view, the hero is in the foreground, about two-thirds of the image height, framed from the knees up, body and head turned toward the viewer; don't shrink the hero to fit more setting in |

**Affects:** every spread page generated after this change, in every book. Existing approved images are not touched.

**How to roll back:**

```
cd ~/Documents/Projects/flipping-smiles
git revert 553e50e
git push origin main
```

If `553e50e` isn't found (for example, after a squash merge changed the hash), find the commit with `git log --oneline --grep "medium shot"` and revert that one instead. Then restart `pnpm dev`. Reverting brings back the wide-angle wording exactly as it was; this log entry stays as history.
