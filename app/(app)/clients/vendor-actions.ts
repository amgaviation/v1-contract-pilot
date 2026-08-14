"use server";

/**
 * The vendor page a pilot hands a client's AP desk — one persistent,
 * revocable rollup of open invoices, total outstanding, and payment
 * history (research roadmap item #12).
 *
 * Every write here is a thin wrapper over the SECURITY DEFINER RPCs in
 * supabase/migrations/20260814112000_client_vendor_page.sql. Those
 * functions carry the membership check that stops a caller naming another
 * tenant's client; this file only turns a form submission into that call
 * and a Postgres error into a sentence. Same division, and the same
 * reasoning, as clients/packet-actions.ts, which this file mirrors
 * throughout down to the revoke-token-echo shape.
 *
 * NEVER logs the token. friendlyDbError logs error.code/error.message on
 * failure and never a returned value; the success path hands the token
 * straight to the component that renders it, and no console.* call in
 * this file touches it.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";

export type VendorLinkState = {
  error: string | null;
  /** The freshly minted token, set only by a successful createVendorLink. */
  token?: string;
  /** True on a revoke that returned without error — see
   * packet-actions.ts's revoked/revokedToken pair for the full reasoning;
   * this mirrors it exactly. */
  revoked?: boolean;
  /** The token the revoke click targeted, echoed back on success or
   * failure once past the client-id check below. */
  revokedToken?: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createVendorLink(
  _prev: VendorLinkState,
  formData: FormData
): Promise<VendorLinkState> {
  const clientId = String(formData.get("client_id") ?? "");
  if (!UUID_RE.test(clientId)) return { error: "Missing client." };

  const daysRaw = String(formData.get("days_valid") ?? "90").trim();
  const days = Number(daysRaw);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return { error: "Choose how long the link should work — 1 to 365 days." };
  }

  await requireAccount("/clients");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("client_vendor_link_create", {
    p_client_id: clientId,
    p_days_valid: days,
  } as never);

  if (error) {
    // The RPC's own rejections are already written for a pilot to read —
    // "client not found", "must be valid for between 1 and 365 days".
    // Passed through verbatim, same as createPacketShare.
    if (typeof error.message === "string" && /not found|1 and 365/.test(error.message)) {
      return { error: error.message };
    }
    return { error: friendlyDbError(error, "client_vendor_link_create") };
  }

  revalidatePath(`/clients/${clientId}`);
  return { error: null, token: data as string };
}

export async function revokeVendorLink(
  _prev: VendorLinkState,
  formData: FormData
): Promise<VendorLinkState> {
  const clientId = String(formData.get("client_id") ?? "");
  if (!UUID_RE.test(clientId)) return { error: "Missing client." };

  // Echoed straight back below, same reasoning as revokePacketShare's own
  // revoking_token — lets the panel tell whether its own still-visible
  // token is the one this dispatch was about.
  const revokingToken = String(formData.get("revoking_token") ?? "") || undefined;

  await requireAccount("/clients");
  const supabase = await createClient();

  // client_vendor_link_revoke returns void, same idempotent-no-op shape as
  // pilot.document_share_revoke/pilot.invoice_share_revoke — see
  // packet-actions.ts's own comment on why the { error } must still be
  // captured and reported rather than discarded.
  const { error } = await supabase.rpc("client_vendor_link_revoke", { p_client_id: clientId } as never);

  if (error) {
    return { error: friendlyDbError(error, "client_vendor_link_revoke"), revokedToken: revokingToken };
  }

  revalidatePath(`/clients/${clientId}`);
  return { error: null, revoked: true, revokedToken: revokingToken };
}
