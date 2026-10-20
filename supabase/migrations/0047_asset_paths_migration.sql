-- Convert all stored asset URLs to storage paths.
-- Before this migration, values looked like:
--   https://<project>.supabase.co/storage/v1/object/public/assets/some/path.png
-- After, they are just:
--   some/path.png
--
-- Run this once, then make the assets bucket private in the Supabase dashboard.

do $$
declare
  base_prefix text := 'https://tdugnafwiusmgawoucly.supabase.co/storage/v1/object/public/assets/';
begin

  -- characters
  update characters
    set cartoon_image_url = replace(cartoon_image_url, base_prefix, '')
    where cartoon_image_url like base_prefix || '%';

  update characters
    set sheet_url = replace(sheet_url, base_prefix, '')
    where sheet_url like base_prefix || '%';

  -- story_pages
  update story_pages
    set image_url = replace(image_url, base_prefix, '')
    where image_url like base_prefix || '%';

  update story_pages
    set image_url_girl = replace(image_url_girl, base_prefix, '')
    where image_url_girl like base_prefix || '%';

  update story_pages
    set text_image_url = replace(text_image_url, base_prefix, '')
    where text_image_url like base_prefix || '%';

  update story_pages
    set text_bg_url = replace(text_bg_url, base_prefix, '')
    where text_bg_url like base_prefix || '%';

  -- order_pages
  update order_pages
    set image_url = replace(image_url, base_prefix, '')
    where image_url like base_prefix || '%';

  update order_pages
    set upscaled_image_url = replace(upscaled_image_url, base_prefix, '')
    where upscaled_image_url like base_prefix || '%';

  update order_pages
    set text_image_url = replace(text_image_url, base_prefix, '')
    where text_image_url like base_prefix || '%';

  -- orders (pdf_url)
  update orders
    set pdf_url = replace(pdf_url, base_prefix, '')
    where pdf_url like base_prefix || '%';

  -- cast_characters (sheet_url used for AI generation)
  update cast_characters
    set sheet_url = replace(sheet_url, base_prefix, '')
    where sheet_url like base_prefix || '%';

  -- cast_character_references (reference images)
  update cast_character_references
    set image_url = replace(image_url, base_prefix, '')
    where image_url like base_prefix || '%';

end $$;
