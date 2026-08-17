import { redirect } from "next/navigation";
import { LAlert, LButton, LCard, lButtonClass } from "@/components/ledger";
import { getSessionContext } from "@/lib/supabase/account";
import { DASHBOARD_PATH } from "@/lib/nav";
import { PLAN_TIERS, TIER_DISPLAY } from "@/lib/entitlements";
import { tierPriceLabels } from "@/lib/stripe/prices";
import { INTRO_FIRST_MONTH_LABEL } from "@/lib/stripe/server";
import { AuthFooter, AuthHeading } from "../auth-parts";
import { signOut } from "./actions";
import { PlanPicker, type PlanOption } from "./welcome-actions";
import { TestBypass } from "./test-bypass";

export const metadata = { title: "Welcome" };

/**
 * The resting state for a signed-in user with no tenant. Per docs/PLAN.md
 * decisions #6/#7 the Stripe checkout webhook is the ONLY thing that
 * creates a tenant, so this page starts that checkout rather than
 * provisioning anything itself.
 *
 * Plan selection happens HERE, at checkout: the three tiers come from
 * lib/entitlements.ts (the one tier source) and every displayed amount is
 * read from the live Stripe Price object (lib/stripe/prices.ts) — the
 * string a pilot reads and the amount Stripe charges are the same fact.
 * A tier whose price env vars aren't configured renders as UNAVAILABLE
 * instead of breaking the page or inventing a figure; that fallback is
 * load-bearing and must survive any redesign of this screen.
 *
 * One claim rule binds anything written on this screen: expenses ATTACH to
 * a trip, they are never "posted from" one — nothing in this product
 * creates an expense from a trip.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.account) redirect(DASHBOARD_PATH);

  const { checkout } = await searchParams;

  // Returning from a completed checkout, but the account isn't visible
  // yet: the webhook is racing this browser redirect and usually wins by
  // a second or two. Say what's happening instead of showing the trial
  // pitch again to someone who just paid, which would read as a failure.
  if (checkout === "complete") {
    return (
      <LCard className="flex flex-col gap-6 p-6 sm:p-8">
        <AuthHeading title="Setting up your account">
          Payment confirmed. We&rsquo;re provisioning now, which usually takes
          a few seconds.
        </AuthHeading>
        {/* A plain link, not a client poller: one deliberate refresh is
            honest about the state and avoids a spinner that could hide a
            genuine webhook failure forever. */}
        <a href="/welcome" className={lButtonClass({ size: "lg", className: "w-full" })}>
          Refresh
        </a>
      </LCard>
    );
  }

  const prices = await tierPriceLabels();
  const options: PlanOption[] = PLAN_TIERS.map((tier) => ({
    tier,
    name: TIER_DISPLAY[tier].name,
    blurb: TIER_DISPLAY[tier].blurb,
    // chargeLabel, not label: for Business this is the ×2 total ("$78/month"),
    // which is what checkout submits and what Stripe bills — see Finding 1 and
    // PriceDisplay in lib/stripe/prices.ts. seatNote spells "$39/seat · 2-seat
    // minimum" beneath it; null for the flat tiers.
    price: {
      monthly: prices[tier].monthly?.chargeLabel ?? null,
      annual: prices[tier].annual?.chargeLabel ?? null,
    },
    seatNote: {
      monthly: prices[tier].monthly?.seatNote ?? null,
      annual: prices[tier].annual?.seatNote ?? null,
    },
  }));

  return (
    <LCard className="flex flex-col gap-6 p-6 sm:p-8">
      <AuthHeading title="Pick your plan">
        Your account starts the moment checkout completes. You can change
        plans any time from Settings.
      </AuthHeading>

      {checkout === "cancelled" ? (
        <LAlert tone="neutral">Checkout cancelled. Nothing was charged.</LAlert>
      ) : null}

      <PlanPicker options={options} introLabel={INTRO_FIRST_MONTH_LABEL} />

      <AuthFooter>
        <form action={signOut}>
          <LButton type="submit" variant="quiet" size="sm">
            Sign out
          </LButton>
        </form>
      </AuthFooter>

      {/* PIN-gated test bypass — renders nothing unless ONBOARDING_TEST_PIN
          is set on this deployment. See test-bypass-actions.ts for the
          gates and the argument for why this doesn't break decision #7. */}
      {process.env.ONBOARDING_TEST_PIN ? <TestBypass /> : null}
    </LCard>
  );
}
