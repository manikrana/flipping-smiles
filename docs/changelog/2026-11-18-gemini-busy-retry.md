# 2026-11-18: Retry Google "busy" errors; never drop the costume silently

## Why
On a test order, Google's image model returned **503 "experiencing high demand"**.
- The costume sheet failed, the store silently fell back to the neutral sheet, and each
  page invented its own pajamas (plaid on spread 1, fair-isle on spread 2).
- The face-refine pass was skipped by the same 503.
- Separately, cartoonize failed outright on `PROHIBITED_CONTENT` (an intermittent block on
  ordinary child photos) and the customer saw only a generic error.

## What changed
| Area | Before | After |
|---|---|---|
| Every Gemini call made through `getGemini()` (both apps) | 429/5xx failed immediately | Retried after 2s, 5s, 10s. Other errors (402 credits, 400, safety blocks) still fail at once |
| Costume sheet generation error (store + studio) | Returned null, so pages got random outfits | Throws, so the page fails and "Try again" rebuilds the sheet. A sheet that fails the *identity* judge still falls back (face first) |
| Cartoonize safety retry | IMAGE_SAFETY only | IMAGE_SAFETY and PROHIBITED_CONTENT, up to 3 attempts |
| Cartoonize photo refused | Generic "Something went wrong" | "We couldn't use this photo. Please try a clear, front-facing photo..." (attempt not counted against retries) |

Files: `apps/{store,studio}/src/lib/gemini.ts`, `apps/store/src/app/orders/[id]/actions.ts`,
`apps/studio/src/app/orders/generate/actions.ts`, `apps/store/src/app/books/[slug]/actions.ts`,
`apps/store/src/app/books/[slug]/OrderForm.tsx`.

## Rollback
`git log --oneline --grep "busy errors"` to find the commit, then `git revert <sha>`.
No database or dependency changes.
