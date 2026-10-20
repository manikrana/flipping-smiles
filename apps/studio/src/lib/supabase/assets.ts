import { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "assets";

const FULL_URL_RE = new RegExp(`/storage/v1/object/(?:public|sign)/${BUCKET}/([^?]+)`);

/**
 * Normalize a stored image reference to a bare bucket-relative path. Handles
 * both the current convention (bare paths, signed at read time) and legacy
 * full URLs (public or already-signed) baked into some older rows from
 * before the assets bucket was made private — those 404/400 if used as-is.
 */
export function resolveStoragePath(value: string): string {
  const match = value.match(FULL_URL_RE);
  return match ? decodeURIComponent(match[1]) : value;
}

/** Sign a storage path for display or server-side fetch (1 hour). */
export async function signAsset(supabase: SupabaseClient, path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error(`Failed to sign asset: ${error?.message}`);
  return data.signedUrl;
}

/** Sign multiple paths at once. */
export async function signAssets(supabase: SupabaseClient, paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
  if (error || !data) throw new Error(`Failed to sign assets: ${error?.message}`);
  return Object.fromEntries(data.map((r) => [r.path, r.signedUrl ?? ""]));
}
