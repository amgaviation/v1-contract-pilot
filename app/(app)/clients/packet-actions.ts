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
  /** The freshly minted token, set only by a successful createPacketShare. */
  token?: string;
  /** True on a revoke that returned without error, so the panel can drop
   * the dead token off screen without waiting on revalidatePath's
   * re-render. Scoped to `revokedToken` below, not a whole-panel latch —
   * see packet-panel.tsx's `token` derivation for why that scoping is
   * load-bearing. */
  revoked?: boolean;
  /** The token the revoke click targeted, echoed back on EVERY revoke
   * dispatch — success or failure. Comparing this against the token a
   * render would otherwise show is how the panel tells a revoke that is
   * still about the link on screen from a stale one left over from
   * earlier in the same mount (a revoke before the most recent create). */
  revokedToken?: string;
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

export async function revokePacketShare(
  _prev: PacketState,
  formData: FormData
): Promise<PacketState> {
  const clientId = String(formData.get("client_id") ?? "");
  if (!UUID_RE.test(clientId)) return { error: "Missing client." };

  // Which token this click meant to kill, echoed straight back below on
  // BOTH the success and error path so the panel can tell whether its own
  // still-visible token is the one this dispatch was about — see
  // packet-panel.tsx's `token` derivation. The panel fills this hidden
  // input from the same value it is currently rendering, not a fresh read
  // of the database, which is exactly what makes it a reliable "was this
  // MY link" check rather than another latch.
  const revokingToken = String(formData.get("revoking_token") ?? "") || undefined;

  await requireAccount("/clients");
  const supabase = await createClient();

  // document_share_revoke returns void — it is an UPDATE with a WHERE
  // clause, not a set-returning function, so there is no row count the
  // client can ask PostgREST for (`{ count: "exact" }` only counts rows
  // OUT of a function; postgrest-js says so on the rpc() signature). That
  // means this action cannot distinguish "revoked one" from "there was
  // nothing to revoke" — and deliberately does not claim to: the only
  // copy this state drives is "the previous link was revoked"
  // (packet-panel.tsx), which is true either way once this call succeeds,
  // since it never asserts THIS click was the one that killed the link,
  // only that the token on screen is now dead. The Revoke button itself
  // only ever renders while a live link is showing, so a genuine
  // zero-row outcome here can only happen via a race (a second tab
  // revoking the same packet a moment earlier) — the sibling
  // pilot.invoice_share_revoke documents the identical void-returning
  // shape as "idempotent no-op if already revoked or never shared" by
  // design, and this one matches it on purpose rather than by omission.
  // What this call CAN and DOES still fail on is the RPC itself erroring
  // — a dropped connection, a permission problem — and that failure was
  // previously thrown away outright: the caller never even captured
  // `{ error }`, so a failed revoke rendered byte-identical to a
  // successful one and a pilot would believe a link carrying their
  // passport was dead when it was still live. Capture it and report it,
  // the same way every other RPC wrapper in this file and
  // share-actions.ts already does.
  const { error } = await supabase.rpc("document_share_revoke", { p_client_id: clientId } as never);

  if (error) {
    return { error: friendlyDbError(error, "document_share_revoke"), revokedToken: revokingToken };
  }

  revalidatePath(`/clients/${clientId}`);
  return { error: null, revoked: true, revokedToken: revokingToken };
}
