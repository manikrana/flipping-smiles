-- Metadata to help personalization workers identify and replace the default placeholder character
ALTER TABLE story_pages
  ADD COLUMN IF NOT EXISTS default_character_description TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS control_depth_map_url TEXT DEFAULT NULL;
