"use server";

/**
 * The credential packet a pilot sends a client — W-9, certificate of
 * insurance, day-rate agreement — as one revocable, expiring link.
 *
 * Every write is a thin wrapper over the SECURITY DEFINER RPCs in
 * supabase/migrations/20260810100000_credential_packet_share.sql. Those
 * functions carry the membership check AND the account_id filter that
 * stops a caller naming another tenant's document; this file only turns a
 * form submission into that call and a Postgres error into a sentence.
 * Same division, and the same reasoning, as invoices/share-actions.ts.
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

export type PacketState = {
  error: string | null;
  token?: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createPacketShare(
  _prev: PacketState,
  formData: FormData
): Promise<PacketState> {
  const clientId = String(formData.get("client_id") ?? "");
  if (!UUID_RE.test(clientId)) return { error: "Missing client." };

  // Checkbox names are `doc:<uuid>`; anything that isn't a uuid is
  // dropped here rather than handed to Postgres as an array element.
  const documentIds = [...formData.keys()]
    .filter((key) => key.startsWith("doc:"))
    .map((key) => key.slice(4))
    .filter((id) => UUID_RE.test(id));

  if (documentIds.length === 0) {
    return { error: "Pick at least one document to include." };
  }

  const daysRaw = String(formData.get("days_valid") ?? "30").trim();
  const days = Number(daysRaw);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return { error: "Choose how long the link should work — 1 to 365 days." };
  }

  await requireAccount("/clients");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("document_share_create", {
    p_client_id: clientId,
    p_document_ids: documentIds,
    p_days_valid: days,
  } as never);

  if (error) {
    // The RPC's own rejections are already written for a pilot to read —
    // "client not found", "none of those documents belong to this
    // account", "must be valid for between 1 and 365 days". Passed
    // through verbatim, the same way createInvoiceShare does; none of
    // them contains a token or anything not already on this screen.
    if (typeof error.message === "string" && /not found|belong to this account|1 and 365/.test(error.message)) {
      return { error: error.message };
    }
    return { error: friendlyDbError(error, "document_share_create") };
  }

  revalidatePath(`/clients/${clientId}`);
  return { error: null, token: data as string };
}

export async function revokePacketShare(formData: FormData): Promise<void> {
  const clientId = String(formData.get("client_id") ?? "");
  if (!UUID_RE.test(clientId)) return;

  await requireAccount("/clients");
  const supabase = await createClient();
  await supabase.rpc("document_share_revoke", { p_client_id: clientId } as never);
  revalidatePath(`/clients/${clientId}`);
}
