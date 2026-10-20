alter table story_pages add column if not exists vertical_align text default 'bottom' check (vertical_align in ('top', 'center', 'bottom'));
