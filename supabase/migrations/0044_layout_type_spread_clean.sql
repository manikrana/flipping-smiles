-- Add spread_left_clean and spread_right_clean to the layout_type enum.
-- All existing values remain intact.

alter type layout_type add value if not exists 'spread_left_clean';
alter type layout_type add value if not exists 'spread_right_clean';
