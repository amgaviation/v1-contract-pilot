import "server-only";
import { looksLikeEmail } from "./address";

/**
 * WHERE MAIL FOR AN ACCOUNT GOES when there is no session to ask: the
 * account owner's own verified auth address, resolved through the admin
 * API. One resolver, shared by every job and webhook that needs it — the
 * scheduled reminder run (reply-to on a chase) and the Stripe webhooks
 * (recipient of a subscription receipt, reply-to on a client's receipt).
 *
 * Returns undefined rather than a fallback when no owner address resolves:
 * each caller already treats "no address" as "send without one" or "skip
 * the send", and substituting the platform's address would put the
 * software vendor into somebody else's correspondence — sendInvoiceEmail's
 * header explains why that is the one outcome that must never happen.
 *
 * NEVER THROWS. Every caller is doing something more important than
 * resolving an address (recording money, sending a legally-owed invoice),
 * and a directory lookup must not take that down.
 */
export async function ownerEmail(
  // Deliberately untyped: the reminder run and both webhooks each construct
  // their own service client, and the two shapes this needs (.from and
  // .auth.admin) are common to all of them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceClient: any,
  accountId: string
): Promise<string | undefined> {
  try {
    const { data } = await serviceClient
      .from("account_members")
      .select("user_id")
      .eq("account_id", accountId)
      .eq("role", "owner")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const userId = (data as { user_id: string } | null)?.user_id;
    if (!userId) return undefined;
    const { data: userData } = await serviceClient.auth.admin.getUserById(userId);
    const email = userData?.user?.email;
    return looksLikeEmail(email) ? email : undefined;
  } catch {
    return undefined;
  }
}
