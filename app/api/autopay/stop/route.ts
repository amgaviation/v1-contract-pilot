import { NextResponse, type NextRequest } from "next/server";
import { detachAutopayMethod } from "@/lib/stripe/connect";
import { createServiceClient } from "@/lib/supabase/service-role";

/**
 * TURNS AUTOPAY OFF, from the client's side. The mirror of ./start — same
 * anonymous posture, same vendor-link token boundary, same service-role
 * reasoning (see start/route.ts's header).
 *
 * A CLIENT WHO CANNOT REVOKE A MANDATE THEY GAVE IS NOT A FEATURE, it is a
 * dispute waiting to happen — card-network rules require a cancellation
 * path for saved-card charging, so this control is as load-bearing as the
 * consent one. The pilot has their own disable on the client's page; this
 * one belongs to the person whose card it is.
 *
 * Order matters: the columns are cleared FIRST (the fact that stops the
 * app charging), the Stripe detach second and best-effort — a Stripe
 * outage must not leave the client told "you're still enrolled" when the
 * app will in fact never charge them again.
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

  const { data: clientData } = await supabase
    .from("clients")
    .select("autopay_stripe_payment_method_id")
    .eq("id", link.client_id)
    .eq("account_id", link.account_id)
    .maybeSingle();
  const paymentMethodId =
    (clientData as { autopay_stripe_payment_method_id: string | null } | null)
      ?.autopay_stripe_payment_method_id ?? null;

  const { error: clearError } = await supabase
    .from("clients")
    .update({
      autopay_stripe_customer_id: null,
      autopay_stripe_payment_method_id: null,
      autopay_method_label: null,
      autopay_consented_at: null,
      autopay_livemode: null,
    } as never)
    .eq("id", link.client_id)
    .eq("account_id", link.account_id);
  if (clearError) {
    console.error("[autopay] disable failed:", clearError.message);
    return NextResponse.redirect(
      new URL(`/vendor/${token}?autopay=error`, request.url),
      303
    );
  }

  if (paymentMethodId) {
    const { data: accountData } = await supabase
      .from("accounts")
      .select("connect_account_id")
      .eq("id", link.account_id)
      .maybeSingle();
    const connectAccountId =
      (accountData as { connect_account_id: string | null } | null)
        ?.connect_account_id ?? null;
    if (connectAccountId) {
      try {
        await detachAutopayMethod({ connectAccountId, paymentMethodId });
      } catch (err) {
        // Best-effort: the columns are already clear, so no charge can be
        // made either way. The stray PaymentMethod is visible in the
        // pilot's own Stripe dashboard if they care.
        console.error(
          "[autopay] detach failed (autopay already off):",
          err instanceof Error ? err.message : "unknown"
        );
      }
    }
  }

  return NextResponse.redirect(
    new URL(`/vendor/${token}?autopay=off`, request.url),
    303
  );
}
