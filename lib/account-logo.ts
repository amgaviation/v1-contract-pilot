import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const BUCKET = "receipts";

/**
 * A short-lived signed URL for an account's uploaded logo, or null if none
 * is set. Same bearer-token-in-a-query-string reasoning as receipts (see
 * app/(app)/settings/actions.ts's logoPreviewUrl, which this mirrors): the
 * bucket is private, so the URL is minted on demand rather than baked into
 * a rendered page, and expires quickly.
 */
export async function accountLogoUrl(
  supabase: SupabaseClient<Database, "pilot">,
  accountId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("accounts")
    .select("logo_url")
    .eq("id", accountId)
    .maybeSingle();

  const path = (data as { logo_url: string | null } | null)?.logo_url;
  if (!path) return null;
  if (!path.startsWith(`${accountId}/`)) return null;

  const { data: signed, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60);
  if (error) {
    console.error("[storage] logo signed url", error.message);
    return null;
  }
  return signed?.signedUrl ?? null;
}
