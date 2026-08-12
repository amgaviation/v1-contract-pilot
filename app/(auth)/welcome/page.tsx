import { redirect } from "next/navigation";
import { Button, Card, Flex, Text } from "@/components/ui";
import { getSessionContext } from "@/lib/supabase/account";
import { DASHBOARD_PATH } from "@/lib/nav";
import { PLAN_TIERS, TIER_DISPLAY } from "@/lib/entitlements";
import { tierPriceLabels } from "@/lib/stripe/prices";
import { TRIAL_PERIOD_DAYS } from "@/lib/stripe/server";
import { signOut } from "./actions";
import { PlanPicker, type PlanOption } from "./welcome-actions";

export const metadata = { title: "Welcome" };

/**
 * The resting state for a signed-in user with no tenant. Per docs/PLAN.md
 * decisions #6/#7 the Stripe checkout webhook is the ONLY thing that
 * creates a tenant, so this page starts that checkout rather than
 * provisioning anything itself.
 *
 * Plan selection happens HERE, at checkout: the three tiers come from
 * lib/entitlements.ts (the one tier source) and every displayed amount
 * is read from the live Stripe Price object (lib/stripe/prices.ts) —
 * the string a pilot reads and the amount Stripe charges are the same
 * fact. A tier whose price env vars aren't configured renders as
 * unavailable instead of breaking the page.
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
      <Card size="4" style={{ width: "100%", maxWidth: "28rem" }}>
        <Flex direction="column" align="center" gap="3" style={{ textAlign: "center" }}>
          <Text size="6" weight="bold">
            Setting up your workspace
          </Text>
          <Text size="2" color="gray">
            Payment confirmed. We&rsquo;re provisioning your account now —
            this usually takes a few seconds.
          </Text>
          {/* A plain link, not a client poller: one deliberate refresh is
              honest about the state and avoids a spinner that could hide
              a genuine webhook failure forever. */}
          <Button asChild mt="2">
            <a href="/welcome">Refresh</a>
          </Button>
        </Flex>
      </Card>
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
    <Card size="4" style={{ width: "100%", maxWidth: "32rem" }}>
      <Flex direction="column" align="center" gap="3" style={{ textAlign: "center" }}>
        <Text size="6" weight="bold">
          You&rsquo;re signed in
        </Text>
        {/*
          "expenses attach to it", not "post from it". Nothing in this product
          creates an expense from a trip — expenses come from the pilot, a
          scanned receipt, or a bank import, and a trip is what they get
          ATTACHED to so they reach the right invoice and the right tax year.
          "Post from it" asserted automatic generation that does not exist.
        */}
        <Text size="2" color="gray">
          Log the trip once — your logbook draft and your invoice lines both
          come from it, and your expenses attach to it. Pick a plan to start
          your trial; you can change plans any time from Settings.
        </Text>

        {checkout === "cancelled" ? (
          <Text size="1" color="gray">
            Checkout cancelled — nothing was charged.
          </Text>
        ) : null}

        <PlanPicker options={options} trialDays={TRIAL_PERIOD_DAYS} />

        <form action={signOut}>
          <Button type="submit" variant="ghost" color="gray" size="1">
            Sign out
          </Button>
        </form>
      </Flex>
    </Card>
  );
}
