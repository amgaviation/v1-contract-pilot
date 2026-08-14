"use server";

/**
 * Server actions for the client-facing estimate share link. Mirrors
 * app/(app)/invoices/share-actions.ts exactly: a thin wrapper over the two
 * SECURITY DEFINER RPCs in
 * supabase/migrations/20260814111000_estimate_share.sql
 * (pilot.estimate_share_create / pilot.estimate_share_revoke) — those
 * functions carry the actual membership + status checks; this file only
 * translates a form submission into that RPC call and turns a Postgres
 * error into a sentence.
 *
 * NEVER logs the token — same rule as invoices/share-actions.ts.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { friendlyDbError } from "@/lib/db-errors";

export type EstimateShareState = {
  error: string | null;
  token?: string;
};

export async function createEstimateShare(
  _prevState: EstimateShareState,
  formData: FormData
): Promise<EstimateShareState> {
  const estimateId = String(formData.get("estimate_id") ?? "");
  if (!estimateId) return { error: "Missing estimate." };

  await requireEntitlement("estimates", "/estimates");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("estimate_share_create", {
    p_estimate_id: estimateId,
  } as never);

  if (error) {
    // pilot.estimate_share_create raises a plain, pilot-readable message
    // for both of its own explicit rejections — surfaced verbatim, same
    // pattern as invoices/share-actions.ts.
    if (
      typeof error.message === "string" &&
      (error.message.includes("cannot be shared") || error.message.includes("not found"))
    ) {
      return { error: error.message };
    }
    return { error: friendlyDbError(error, "estimate_share_create") };
  }

  revalidatePath(`/estimates/${estimateId}`);
  return { error: null, token: data as string };
}

export async function revokeEstimateShare(
  _prevState: EstimateShareState,
  formData: FormData
): Promise<EstimateShareState> {
  const estimateId = String(formData.get("estimate_id") ?? "");
  if (!estimateId) return { error: "Missing estimate." };

  await requireEntitlement("estimates", "/estimates");
  const supabase = await createClient();

  const { error } = await supabase.rpc("estimate_share_revoke", {
    p_estimate_id: estimateId,
  } as never);

  if (error) {
    return { error: friendlyDbError(error, "estimate_share_revoke") };
  }

  revalidatePath(`/estimates/${estimateId}`);
  return { error: null };
}
