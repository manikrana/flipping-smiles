-- Add spread_left and spread_right to the layout_type enum on stories.
-- split_image_left / split_image_right / overlay_bottom remain fully intact.

alter type layout_type add value if not exists 'split_image_left';
alter type layout_type add value if not exists 'split_image_right';
alter type layout_type add value if not exists 'spread_left';
alter type layout_type add value if not exists 'spread_right';
