# 2026-11-21: Sample name in browse titles ("Alex")

## Why
"{{hero_name}} and the Night of Christmas Magic" carries the name in the **title**. The store only swapped `{{hero_name}}` in the cover **subtitle**, so the raw token showed on book cards, the book page and the create page. The order page, cart and confirmation emails also showed the raw title instead of the child's name.

## What changed
| Where | Before | After |
|---|---|---|
| Book card, book page, create page (cover overlay, alt text, headings) | Title shown raw; subtitle used a hashed default name | Title and subtitle both use the book's sample name |
| Order page, cart, confirmation and shipping emails | Raw title | Title with the child's real name |
| Sample name source | Hashed pick from a fixed boy list | `stories.sample_hero_name` (new column), falling back to the same hashed list |

The migration `0070_story_sample_hero_name.sql` adds the column and sets **Alex** for `the-night-of-christmas-magic`. Until it runs, every page falls back to the old list (the story queries use `select("*")`, so nothing breaks).

## Rollback
`git log --oneline --grep "sample name"` then `git revert <sha>`. The column can stay; it is ignored without the code.
