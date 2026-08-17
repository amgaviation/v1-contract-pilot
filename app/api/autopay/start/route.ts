import { NextResponse, type NextRequest } from "next/server";
import { createAutopaySetupSession } from "@/lib/stripe/connect";
import { createServiceClient } from "@/lib/supabase/service-role";

/**
 * STARTS AUTOPAY CONSENT — the pilot's client, on the vendor page, asking
 * to save a card for automatic charging of recurring invoices.
 *
 * ANONYMOUS BY DESIGN, like the page it is posted from: the caller is the
 * client's AP desk, which has no account here and never will. The
 * vendor-link token in the form body is the whole credential — resolved
 * server-side against pilot.client_vendor_links (unrevoked, unexpired),
 * exactly the boundary pilot.client_vendor_page_public draws for the page
 * itself. Nothing in the response discloses whether a token that failed
 * was unknown, revoked, or expired.
 *
 * SERVICE ROLE, and why that is sound here: the anon Postgres role has no
 * read on client_vendor_links (only the SECURITY DEFINER page functions),
 * and this route additionally needs accounts.connect_account_id and the
 * client's existing autopay customer — none of which belong in an
 * anon-executable SQL function's return value. The token check happens
 * FIRST, before any of that is read, and every read is scoped to the ids
 * the token resolved to.
 *
 * The redirect target is Stripe's own hosted setup page ON THE PILOT'S
 * CONNECTED ACCOUNT — card details never touch this server. Completion
 * comes back through the Connect webhook, the only writer of the client's
 * autopay columns.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ error: "Unknown link" }, { status: 404 });
  }

  const supabase = createServiceClient();

  const { data: linkData, error: linkError } = await supabase
    .from("client_vendor_links")
    .select("account_id, client_id, revoked_at, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (linkError) {
    console.error("[autopay] vendor link read failed:", linkError.message);
    return NextResponse.json({ error: "Try again" }, { status: 500 });
  }
  const link = linkData as {
    account_id: string;
    client_id: string;
    revoked_at: string | null;
    expires_at: string;
  } | null;
  if (!link || link.revoked_at || Date.parse(link.expires_at) <= Date.now()) {
    return NextResponse.json({ error: "Unknown link" }, { status: 404 });
  }

  const [{ data: accountData }, { data: clientData }] = await Promise.all([
    supabase
      .from("accounts")
      .select("connect_account_id")
      .eq("id", link.account_id)
      .maybeSingle(),
    supabase
      .from("clients")
      .select("name, autopay_stripe_customer_id")
      .eq("id", link.client_id)
      .eq("account_id", link.account_id)
      .maybeSingle(),
  ]);
  const account = accountData as { connect_account_id: string | null } | null;
  const client = clientData as {
    name: string;
    autopay_stripe_customer_id: string | null;
  } | null;
  if (!account?.connect_account_id || !client) {
    // The pilot disconnected Stripe between page render and click, or the
    // client row is gone. Send them back to the page, which now says so.
    return NextResponse.redirect(new URL(`/vendor/${token}`, request.url), 303);
  }

  // The vendor page to come back to. NEXT_PUBLIC_APP_URL first, Host
  // second — the same header-poisoning reasoning as
  // forgot-password/actions.ts: this URL ends up in a redirect a client
  // follows, and an Origin-derived one is forgeable.
  const base =
    process.env.NEXT_PUBLIC_APP_URL ?? `https://${request.headers.get("host")}`;

  try {
    const session = await createAutopaySetupSession({
      connectAccountId: account.connect_account_id,
      accountId: link.account_id,
      clientId: link.client_id,
      clientName: client.name,
      existingCustomerId: client.autopay_stripe_customer_id,
      returnUrl: `${base}/vendor/${token}`,
    });
    // 303: this response answers a POST and the destination is a GET.
    return NextResponse.redirect(session.url, 303);
  } catch (err) {
    console.error(
      "[autopay] setup session failed:",
      err instanceof Error ? err.message : "unknown"
    );
    return NextResponse.redirect(
      new URL(`/vendor/${token}?autopay=error`, request.url),
      303
    );
  }
}
