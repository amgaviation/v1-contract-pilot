"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/supabase/account";
import { getStripe, getSoloPriceId, TRIAL_PERIOD_DAYS } from "@/lib/stripe/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export type CheckoutState = { error: string | null };

/**
 * Starts the card-required trial (decision #6). This creates the Checkout
 * session only — it does NOT create a tenant. Provisioning happens solely
 * in the webhook when Stripe confirms the checkout completed (decision
 * #7), so a user who abandons the payment page, or fakes a return to the
 * success URL, never gets an account.
 */
export async function startCheckout(
  _prev: CheckoutState,
  _formData: FormData
): Promise<CheckoutState> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.account) redirect("/");

  const origin = (await headers()).get("origin");
  if (!origin) {
    return { error: "Could not determine the return address. Try again." };
  }

  let url: string | null = null;
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: getSoloPriceId(), quantity: 1 }],
      // Ties the Stripe session back to the Supabase identity. The webhook
      // reads this to know WHICH auth user to provision an account for —
      // without it there is no link between the payment and the person.
      client_reference_id: ctx.user.id,
      customer_email: ctx.user.email,
      subscription_data: {
        trial_period_days: TRIAL_PERIOD_DAYS,
        metadata: { supabase_user_id: ctx.user.id },
      },
      // Card required up front even though the trial is free, per decision
      // #6 — this is what makes the trial convert without a second ask.
      payment_method_collection: "always",
      metadata: { supabase_user_id: ctx.user.id },
      // Land back on /welcome: the tenant may not exist for a moment
      // (the webhook is racing the browser redirect), and that page polls
      // rather than showing a broken app shell.
      success_url: `${origin}/welcome?checkout=complete`,
      cancel_url: `${origin}/welcome?checkout=cancelled`,
    });
    url = session.url;
  } catch (err) {
    // The raw Stripe message is a CONFIGURATION disclosure, not a readable
    // error. A wrong or deleted price renders "No such price:
    // 'price_1Qabc...'" and a bad key renders "Invalid API Key provided:
    // sk_test_...****" — Stripe object ids and the key's mode, handed to
    // an unprovisioned visitor who has not paid for anything yet. It also
    // tells them nothing they can act on: every one of these is our
    // misconfiguration, not their mistake.
    //
    // Logged in full server-side, where it is the thing that actually
    // diagnoses the outage. Same posture as friendlyDbError.
    console.error(
      "[stripe] checkout session creation failed",
      err instanceof Error ? err.message : String(err)
    );
    return {
      error:
        "Couldn't start checkout. Try again, or get in touch if this keeps happening.",
    };
  }

  if (!url) {
    return { error: "Stripe did not return a checkout URL. Try again." };
  }
  redirect(url);
}
