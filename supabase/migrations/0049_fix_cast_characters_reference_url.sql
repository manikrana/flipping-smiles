-- Strip public URL prefix from cast_characters.reference_url (missed in 0047)
do $$
declare
  base_prefix text := 'https://tdugnafwiusmgawoucly.supabase.co/storage/v1/object/public/assets/';
begin
  update cast_characters
    set reference_url = replace(reference_url, base_prefix, '')
    where reference_url like base_prefix || '%';
end $$;
