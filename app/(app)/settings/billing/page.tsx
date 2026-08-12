import { Badge, Callout, Card, Flex, Grid, Text } from "@/components/ui";
import { requireAccount } from "@/lib/supabase/account";
import {
  DOWNGRADE_NOTE,
  FEATURES,
  PLAN_TIERS,
  TIER_DISPLAY,
  TIER_RANK,
  featuresAddedByTier,
  tierForPriceId,
  type BillingInterval,
  type PlanTier,
} from "@/lib/entitlements";
import { tierPriceLabels } from "@/lib/stripe/prices";
import { getStripe } from "@/lib/stripe/server";
import { formatDate } from "@/lib/format";
import PageShell from "../../page-shell";
import {
  BillingPortalButton,
  ChangePlanButtons,
  SwitchIntervalButton,
} from "./billing-buttons";

export const metadata = { title: "Billing" };

const STATUS_LABEL: Record<string, string> = {
  trialing: "Trialing",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
  unpaid: "Unpaid",
  incomplete: "Incomplete",
  incomplete_expired: "Incomplete (expired)",
  paused: "Paused",
};

/**
 * The subscription's CURRENT interval and any tier-sync lag, read from
 * Stripe. Display-only and fully optional: a Stripe blip degrades to
 * "interval unknown", never to a broken page. The authoritative tier is
 * always pilot.accounts.plan_tier — written by the webhook, nothing else.
 */
async function currentSubscriptionFacts(
  subscriptionId: string | null
): Promise<{ interval: BillingInterval | null; pendingTier: PlanTier | null }> {
  if (!subscriptionId) return { interval: null, pendingTier: null };
  try {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    const priceId = subscription.items.data[0]?.price?.id ?? null;
    const match = tierForPriceId(priceId);
    return { interval: match?.interval ?? null, pendingTier: match?.tier ?? null };
  } catch (err) {
    console.error(
      "[stripe] could not read subscription for billing screen",
      err instanceof Error ? err.message : String(err)
    );
    return { interval: null, pendingTier: null };
  }
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ changed?: string }>;
}) {
  const { changed } = await searchParams;
  const { account, role } = await requireAccount("/settings/billing");
  const canEdit = role === "owner";

  const tier = account.plan_tier;
  const isComped = account.stripe_customer_id === null;

  const [prices, subscriptionFacts] = await Promise.all([
    tierPriceLabels(),
    isComped
      ? Promise.resolve({ interval: null, pendingTier: null } as const)
      : currentSubscriptionFacts(account.stripe_subscription_id),
  ]);

  // Stripe has already confirmed a different price than the tier on
  // record — the webhook confirmation is in flight. Say so rather than
  // letting the screen look like the click didn't take.
  const pendingTier =
    subscriptionFacts.pendingTier && subscriptionFacts.pendingTier !== tier
      ? subscriptionFacts.pendingTier
      : null;

  return (
    <PageShell
      title="Billing"
      subtitle="Your plan, what it includes, and your payment details."
    >
      {changed === "1" || pendingTier ? (
        <Callout.Root color={pendingTier ? "blue" : "green"}>
          <Callout.Text>
            {pendingTier
              ? `Stripe has confirmed your switch to ${TIER_DISPLAY[pendingTier].name}. It takes effect here the moment Stripe's confirmation event arrives — usually within seconds. Refresh to see it.`
              : "Plan change confirmed with Stripe."}
          </Callout.Text>
        </Callout.Root>
      ) : null}

      <Card>
        <Flex direction="column" gap="2" p="1">
          <Flex align="center" gap="2">
            <Text weight="bold" size="4">
              Current plan: {TIER_DISPLAY[tier].name}
            </Text>
            <Badge color="blue">{STATUS_LABEL[account.status] ?? account.status}</Badge>
            {subscriptionFacts.interval ? (
              <Badge color="gray">
                {subscriptionFacts.interval === "monthly" ? "Monthly" : "Annual"} billing
              </Badge>
            ) : null}
          </Flex>
          {account.status === "trialing" && account.trial_ends_at ? (
            <Text size="2" color="gray">
              Trial ends {formatDate(account.trial_ends_at)}. Your card is charged
              after that.
            </Text>
          ) : null}
          {isComped ? (
            <Text size="2" color="gray">
              This account isn&rsquo;t billed through Stripe — its plan is managed
              for you, so there&rsquo;s nothing to change here.
            </Text>
          ) : (
            <Text size="2" color="gray">
              Plan changes are confirmed with Stripe first and take effect here on
              Stripe&rsquo;s confirmation — the same path your subscription itself
              arrives by.
            </Text>
          )}
          {!canEdit && !isComped ? (
            <Text size="1" color="gray">
              Only the account owner can change the plan or billing details.
            </Text>
          ) : null}
        </Flex>
      </Card>

      {!isComped ? (
        <>
          <Grid columns={{ initial: "1", md: "3" }} gap="4">
            {PLAN_TIERS.map((planTier) => {
              const isCurrent = planTier === tier;
              const direction: "Upgrade" | "Downgrade" =
                TIER_RANK[planTier] > TIER_RANK[tier] ? "Upgrade" : "Downgrade";
              const added = featuresAddedByTier(planTier);
              const previousTier: PlanTier | null =
                planTier === "pro" ? "solo" : planTier === "business" ? "pro" : null;
              const monthly = prices[planTier].monthly;
              const annual = prices[planTier].annual;
              // The interval switch on the current tier: offer the one
              // interval the subscription is NOT already on.
              const otherInterval: BillingInterval | null =
                subscriptionFacts.interval === "monthly"
                  ? "annual"
                  : subscriptionFacts.interval === "annual"
                    ? "monthly"
                    : null;
              const otherIntervalPrice = otherInterval
                ? prices[planTier][otherInterval]
                : null;

              return (
                <Card key={planTier}>
                  <Flex direction="column" gap="2" p="1" height="100%">
                    <Flex align="center" justify="between" gap="2">
                      <Text weight="bold" size="4">
                        {TIER_DISPLAY[planTier].name}
                      </Text>
                      {isCurrent ? <Badge color="blue">Current plan</Badge> : null}
                    </Flex>
                    <Text size="2" color="gray">
                      {monthly ? monthly.label : "—"}
                      {annual ? ` · ${annual.label}` : ""}
                    </Text>
                    <Text size="2" color="gray">
                      {TIER_DISPLAY[planTier].blurb}
                    </Text>
                    <Flex direction="column" gap="1" mt="1" flexGrow="1">
                      {previousTier ? (
                        <Text size="1" weight="bold" color="gray">
                          Everything in {TIER_DISPLAY[previousTier].name}, plus:
                        </Text>
                      ) : (
                        <Text size="1" weight="bold" color="gray">
                          Includes:
                        </Text>
                      )}
                      {added.map((feature) => (
                        <Text size="1" color="gray" key={feature}>
                          &bull; {FEATURES[feature].label}
                          {FEATURES[feature].comingSoon ? " (coming soon)" : ""}
                        </Text>
                      ))}
                    </Flex>
                    <Flex direction="column" gap="2" mt="2">
                      {isCurrent ? (
                        otherInterval && otherIntervalPrice ? (
                          <SwitchIntervalButton
                            tier={planTier}
                            targetInterval={otherInterval}
                            label={`Switch to ${otherInterval} billing — ${otherIntervalPrice.label}`}
                            disabled={!canEdit}
                          />
                        ) : null
                      ) : (
                        <ChangePlanButtons
                          tier={planTier}
                          direction={direction}
                          monthlyLabel={monthly?.label ?? null}
                          annualLabel={annual?.label ?? null}
                          disabled={!canEdit}
                        />
                      )}
                    </Flex>
                  </Flex>
                </Card>
              );
            })}
          </Grid>

          <Card>
            <Flex direction="column" gap="2" p="1">
              <Text weight="bold" size="3">
                Downgrading
              </Text>
              <Text size="2" color="gray">
                {DOWNGRADE_NOTE}
              </Text>
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="2" p="1">
              <Text weight="bold" size="3">
                Payment details
              </Text>
              <Text size="2" color="gray">
                Your card, invoices, and cancellation are handled in Stripe&rsquo;s
                secure billing portal — we never see your card number.
              </Text>
              <Flex>
                <BillingPortalButton disabled={!canEdit} />
              </Flex>
            </Flex>
          </Card>
        </>
      ) : null}
    </PageShell>
  );
}
