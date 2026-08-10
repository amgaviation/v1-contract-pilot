import { redirect } from "next/navigation";
import { Button, Card, Flex, Text } from "@/components/ui";
import { getSessionContext } from "@/lib/supabase/account";
import { DASHBOARD_PATH } from "@/lib/nav";
import { signOut } from "./actions";
import { StartTrialButton } from "./welcome-actions";

export const metadata = { title: "Welcome" };

// Presentational only — the authoritative amount is the Stripe Price
// (STRIPE_PRICE_ID_SOLO), which is what actually gets charged. Kept in sync
// by hand; the price object is the source of truth, not this string.
const PRICE_LABEL = "$29/month";

/**
 * The resting state for a signed-in user with no tenant. Per docs/PLAN.md
 * decisions #6/#7 the Stripe checkout webhook is the ONLY thing that
 * creates a tenant, so this page starts that checkout rather than
 * provisioning anything itself.
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

  return (
    <Card size="4" style={{ width: "100%", maxWidth: "28rem" }}>
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
          come from it, and your expenses attach to it. Start your trial to set
          up your workspace.
        </Text>

        {checkout === "cancelled" ? (
          <Text size="1" color="gray">
            Checkout cancelled — nothing was charged.
          </Text>
        ) : null}

        <StartTrialButton priceLabel={PRICE_LABEL} />

        <form action={signOut}>
          <Button type="submit" variant="ghost" color="gray" size="1">
            Sign out
          </Button>
        </form>
      </Flex>
    </Card>
  );
}
