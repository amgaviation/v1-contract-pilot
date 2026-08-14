"use server";

/**
 * The client's own answer to a quote — the two actions this route's
 * "Accept" / "Decline" buttons post to. No session, no requireAccount: a
 * visitor here has no account on this product and never will (same
 * un-gated posture as app/invoice/[token]'s own view). Every real check —
 * is the token live, is the estimate still 'sent', is this NOT the owning
 * account's own preview — happens inside the SECURITY DEFINER RPCs
 * (pilot.estimate_public_accept / pilot.estimate_public_decline,
 * supabase/migrations/20260814111000_estimate_share.sql). This file's job
 * is only to call them and turn a genuine failure into a sentence; a token
 * that doesn't apply (unknown, revoked, already answered) is a SILENT
 * no-op by the RPC's own design, so it renders here as "nothing changed"
 * rather than an error — the page re-fetches pilot.estimate_public
 * afterwards and shows whatever the real status turns out to be.
 */

import { createClient } from "@/lib/supabase/server";

export async function acceptPublicEstimate(token: string): Promise<{ error: string | null }> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { error: null };
  const supabase = await createClient();
  const { error } = await supabase.rpc("estimate_public_accept", { p_token: token } as never);
  if (error) {
    return { error: "Couldn't record that just now. Try again in a moment." };
  }
  return { error: null };
}

export async function declinePublicEstimate(token: string): Promise<{ error: string | null }> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { error: null };
  const supabase = await createClient();
  const { error } = await supabase.rpc("estimate_public_decline", { p_token: token } as never);
  if (error) {
    return { error: "Couldn't record that just now. Try again in a moment." };
  }
  return { error: null };
}
