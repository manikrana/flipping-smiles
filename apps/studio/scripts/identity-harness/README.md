# Identity persistence harness

This is a small, database-free test loop for the part of the pipeline that is
currently weak: applying an already-approved cartoon identity to a finished
scene. It deliberately does **not** cartoonize the source photo.

It produces, for every scene and prompt variant:

- the untouched model output;
- an enlarged crop of the hero's face using the same normalized box for every
  candidate;
- a contact sheet with the approved portrait beside every candidate face;
- a blinded HTML review page with 1–5 likeness ratings and JSON export;
- an outside-hero pixel-drift score (diagnostic only; lower is better).

It does not use an LLM likeness judge. Previous experiments showed that judge
is too noisy at the top of the range. The review is intentionally centered on
the portrait and enlarged face crops, where a human can detect the exact drift.

Wardrobe is a more objective comparison than facial likeness, so an optional
standalone judge mirrors the website's production gate and can check any saved
scene without regenerating it:

```sh
pnpm --filter @kitabee/studio identity:wardrobe-judge -- \
  --sheet /absolute/path/to/costumed-sheet.png \
  --scene /absolute/path/to/generated-scene.png \
  --confirm-spend
```

## Set up a run

Copy `example.manifest.json` somewhere outside source control and replace the
paths. All relative paths are resolved from the manifest's directory. Boxes
use Gemini's normalized `[ymin, xmin, ymax, xmax]` coordinates from 0–1000.
They do not need to be perfectly tight; `heroHeadBox` is padded before the
review crop is made.

`headSheet`, `bodySheet`, `heroHeadBox`, and `heroBodyBox` are optional. The
portrait and template are required. Without a head box, the harness still
generates candidates but cannot create useful enlarged face comparisons.

Validate inputs and see cost without calling Gemini:

```sh
pnpm --filter @kitabee/studio identity:harness -- \
  --manifest /absolute/path/to/identity.manifest.json
```

Run the paid image generations:

```sh
pnpm --filter @kitabee/studio identity:harness -- \
  --manifest /absolute/path/to/identity.manifest.json \
  --run --confirm-spend
```

Useful filters:

```sh
# One scene and one variant, with two stochastic samples
pnpm --filter @kitabee/studio identity:harness -- \
  --manifest /absolute/path/to/identity.manifest.json \
  --case standing-front --variant production --candidates 2 \
  --run --confirm-spend
```

The harness reads `GOOGLE_GEMINI_API_KEY` from the environment, then falls
back to `apps/studio/.env.local`. It never uploads or uses the raw child photo;
only the AI-created portrait and optional derived sheets are sent.

## Sunburst masked-crop experiment

The focused Sunburst experiment uses the same manifest, requires
`heroBodyBox`, and edits a padded crop rather than the full spread. It derives
a black/white edit mask from the template's white silhouette, grows it slightly
to cover the mannequin rim, and pastes the returned patch through that same
matte into the untouched full-resolution template.

```sh
pnpm --filter @kitabee/studio identity:sunburst -- \
  --manifest /absolute/path/to/identity.manifest.json \
  --case standing-front --quality medium --confirm-spend
```

To compare a whole-spread edit, ask Sunburst for its maximum 2:1 output. The
harness then performs a deterministic Sharp resize from 3840×1920 to the
template's original dimensions (5100×2550 here):

```sh
pnpm --filter @kitabee/studio identity:sunburst -- \
  --manifest /absolute/path/to/identity.manifest.json \
  --case standing-front --quality medium --full-scene --confirm-spend
```

To make the costumed body sheet the sole wardrobe authority, test the explicit
wardrobe lock. The optional head-only portrait removes visible portrait clothes
before upload, preventing them from competing with the book costume:

```sh
pnpm --filter @kitabee/studio identity:sunburst -- \
  --manifest /absolute/path/to/identity.manifest.json \
  --case standing-front --quality medium --full-scene \
  --wardrobe-lock --head-only-portrait --confirm-spend
```

This uses `openai/gpt-image-2.5/sunburst/edit` through fal. It reads `FAL_KEY`
from the environment or `apps/studio/.env.local`. Generated output is written
under the manifest's `outputDir`; the raw uploaded child photo is never used.

## Hybrid full-scene generation + deterministic composite

After generating a complete scene with Sunburst, the hybrid experiment uses
SAM 3 to segment the child from a padded crop of that output. It fills the
original white mannequin only through the original silhouette mask, then lays
the generated child over the untouched source scene using the new pose's own
alpha mask. This allows hair and limbs to extend beyond the old mannequin while
keeping pixels outside the old mannequin and extracted child unchanged.

```sh
pnpm --filter @kitabee/studio identity:hybrid -- \
  --manifest /absolute/path/to/identity.manifest.json \
  --case standing-front \
  --generated /absolute/path/to/full-scene-result.png \
  --confirm-spend
```

The segmentation call uses `fal-ai/sam-3/image` through fal. The command writes
the raw masks, normalized alpha mattes, composited candidates, and a JSON report
under the manifest's `outputDir`.

If a run completed segmentation but local compositing needs to be repeated,
reuse its downloaded mask without another paid request:

```sh
pnpm --filter @kitabee/studio identity:hybrid -- \
  --manifest /absolute/path/to/identity.manifest.json \
  --case standing-front \
  --generated /absolute/path/to/full-scene-result.png \
  --mask /absolute/path/to/04-sam-mask-1.png
```

## Review existing images without spending money

Candidates produced elsewhere can be added to a case:

```json
"existingCandidates": [
  { "label": "current-production", "path": "/absolute/path/current.png" },
  { "label": "experiment-b", "path": "/absolute/path/experiment-b.png" }
]
```

Run the harness without `--run`. It will build the same crops, contact sheets,
drift metrics, and review page at zero API cost.

## Built-in variants

- `production`: mirrors the live body → portrait → head reference order and
  the current long production instruction.
- `portrait-head-first`: places the high-resolution face authorities first and
  shortens the instruction. It is included as a stable comparison arm, not as
  an assumed improvement.
- `portrait-only`: isolates whether the generated turnaround sheets themselves
  are pulling the face away from the accepted portrait.

Add a custom variant directly in the manifest when testing a hypothesis:

```json
{
  "id": "my-test",
  "referenceOrder": ["portrait", "head", "body"],
  "promptStyle": "concise",
  "extraInstruction": "One precise instruction being tested."
}
```

Change one variable per variant. A useful minimum is three scenes (front,
three-quarter, and profile/action) with two candidates per arm. The harness
does not claim statistical significance; it makes iteration fast and keeps the
visual evidence organized.
