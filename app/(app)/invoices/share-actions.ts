"use server";

/**
 * Server actions for the client-facing invoice share link (docs/PLAN.md's
 * "connect payments" gap: a pilot needs something to actually SEND a
 * client, not just a Stripe link buried behind their own login). Every
 * write here is a thin wrapper over the two SECURITY DEFINER RPCs in
 * supabase/migrations/20260809060000_invoice_public_share.sql
 * (pilot.invoice_share_create / pilot.invoice_share_revoke) — those
 * functions carry the actual membership + status checks; this file's job
 * is only to translate a form submission into that RPC call and turn a
 * Postgres error into a sentence, the same shape every other actions.ts
 * in this app already uses.
 *
 * NEVER logs the token. `friendlyDbError` logs `error.code`/`error.message`
 * on failure, never a returned value, and the success path here returns
 * the token straight to the client component that renders it — no
 * `console.*` call in this file ever touches it.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";

export type ShareState = {
  error: string | null;
  token?: string;
};

/**
 * Mints (or, if one already exists, ROTATES — see the migration's own
 * comment on pilot.invoice_shares' unique(account_id, invoice_id)) the
 * share token for one invoice. Only reachable from a signed-in session;
 * the RPC itself re-derives membership from auth.uid(), never from
 * anything this action passes.
 */
export async function createInvoiceShare(
  _prevState: ShareState,
  formData: FormData
): Promise<ShareState> {
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!invoiceId) return { error: "Missing invoice." };

  await requireAccount("/invoices");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("invoice_share_create", {
    p_invoice_id: invoiceId,
  } as never);

  if (error) {
    // pilot.invoice_share_create raises a plain, pilot-readable message
    // for both of its own explicit rejections ("not found" for a
    // cross-tenant/nonexistent id, "cannot be shared" for a draft/void
    // invoice) — surfaced verbatim, the same way linesDbError in
    // invoices/actions.ts passes through invoice_lines_validate_trip's own
    // message. Neither message contains a token or anything else that
    // wasn't already visible to this pilot on the invoice screen.
    if (
      typeof error.message === "string" &&
      (error.message.includes("cannot be shared") || error.message.includes("not found"))
    ) {
      return { error: error.message };
    }
    return { error: friendlyDbError(error, "invoice_share_create") };
  }

  revalidatePath(`/invoices/${invoiceId}`);
  return { error: null, token: data as string };
}

export async function revokeInvoiceShare(
  _prevState: ShareState,
  formData: FormData
): Promise<ShareState> {
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!invoiceId) return { error: "Missing invoice." };

  await requireAccount("/invoices");
  const supabase = await createClient();

  const { error } = await supabase.rpc("invoice_share_revoke", {
    p_invoice_id: invoiceId,
  } as never);

  if (error) {
    return { error: friendlyDbError(error, "invoice_share_revoke") };
  }

  revalidatePath(`/invoices/${invoiceId}`);
  return { error: null };
}
