-- Raise the per-file limit on the assets bucket to 500 MB to accommodate LoRA weights files
update storage.buckets set file_size_limit = 524288000 where id = 'assets';
