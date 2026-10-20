"use client";

import { CoverEditor } from "./CoverEditor";
import type { StoryRow, StoryPageRow, CastCharacterRow } from "@/lib/supabase/types";
import type { PageSummary } from "./StoryPagePanel";

interface Props {
  story: StoryRow;
  pages: PageSummary[];
  allCharacters: CastCharacterRow[];
}

export function CoverPanel({ story, pages, allCharacters }: Props) {
  // Build StoryPageRow-compatible objects from the in-memory PageSummary state
  // so CoverEditor always sees the latest approved images without a full reload.
  const approvedPages = pages
    .filter((p) => p.image_approved && p.image_url)
    .map(
      (p): StoryPageRow => ({
        id: p.id,
        page_number: p.page_number,
        image_url: p.image_url,
        image_url_girl: p.image_url_girl,
        image_approved: p.image_approved,
        preview_eligible: p.preview_eligible ?? false,
        text_image_url: p.text_image_url,
        text_bg_url: p.text_bg_url ?? null,
        text: p.text,
        scene_prompt: p.scene_prompt,
        scene_prompt_girl: p.scene_prompt_girl ?? null,
        hero_boy_character_id: p.hero_boy_character_id ?? null,
        hero_girl_character_id: p.hero_girl_character_id ?? null,
        story_id: story.id,
        default_character_description: null,
        continuity_reference_page_id: null,
        vertical_align: p.vertical_align ?? null,
        character_count_verified: p.character_count_verified ?? null,
        created_at: "",
      })
    );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-800">Cover</h2>
        <p className="text-sm text-gray-500">
          Pick an approved scene and style the title overlay.
        </p>
      </div>
      <CoverEditor story={story} approvedPages={approvedPages} allCharacters={allCharacters} />
    </div>
  );
}
