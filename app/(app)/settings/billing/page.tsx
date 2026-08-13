import NextLink from "next/link";
import {
  Badge,
  Callout,
  Card,
  DataList,
  Flex,
  Grid,
  Heading,
  Link as RadixLink,
  Separator,
  Table,
  Text,
  VisuallyHidden,
} from "@/components/ui";
import EmptyState from "@/components/ui/empty-state";
import { accountIsReadOnly, requireAccount } from "@/lib/supabase/account";
import {
  DOWNGRADE_NOTE,
  FEATURES,
  PLAN_TIERS,
  TIER_DISPLAY,
  TIER_RANK,
  featuresAddedByTier,
  marketingMatrix,
  type BillingInterval,
  type PlanTier,
} from "@/lib/entitlements";
import {
  renewalNotice,
  renewalText,
  statusDisplay,
  statusIsWritable,
} from "@/lib/billing-state";
import { tierPriceLabels } from "@/lib/stripe/prices";
import { billingHistory, subscriptionFacts } from "@/lib/stripe/billing-facts";
import { formatDate } from "@/lib/format";
import PageShell from "../../page-shell";
import {
  BillingPortalButton,
  CancelResumeButton,
  ChangePlanButtons,
  SwitchIntervalButton,
} from "./billing-buttons";

export const metadata = { title: "Billing" };

/**
 * PLAN MANAGEMENT.
 *
 * What this screen may and may not do is fixed by the platform-billing
 * rules the webhook already enforces, and none of the depth added here
 * bends them:
 *
 *   - THE TIER ON RECORD IS pilot.accounts.plan_tier, written by the
 *     Stripe webhook and by nothing else. This page reads Stripe only so
 *     it can DESCRIBE state (interval, renewal date, a switch still in
 *     flight); it never writes an entitlement column, and there is no
 *     service-role client anywhere in this route.
 *   - EVERY AMOUNT COMES FROM A LIVE STRIPE OBJECT, through
 *     lib/stripe/prices.ts. Catalogue prices via tierPriceLabels(); this
 *     customer's own renewal and past invoices via
 *     lib/stripe/billing-facts.ts, which formats through the same module.
 *     There is no number typed into this file.
 *   - WHAT A TIER INCLUDES COMES FROM lib/entitlements.ts. The comparison
 *     table below renders marketingMatrix() — the same rows the public
 *     pricing page renders — rather than a second hand-kept matrix that
 *     could disagree with what the app actually gates.
 *   - requireAccount(..., { allowReadOnly: true }) because this is a READ
 *     and, more importantly, the destination a refused write is sent to.
 *     A lapsed account must be able to load this page and resubscribe.
 */

/** Which of the two Stripe reads a card depends on, said once. */
const STRIPE_UNREACHABLE =
  "We couldn't reach Stripe just now, so the details below are incomplete. This is not a statement about your subscription — reload in a moment, or open the billing portal.";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ changed?: string; state?: string }>;
}) {
  const { changed, state } = await searchParams;
  const { account, role } = await requireAccount("/settings/billing", {
    allowReadOnly: true,
  });
  const canEdit = role === "owner";
  const readOnly = accountIsReadOnly(account);

  const tier = account.plan_tier;
  const isComped = account.stripe_customer_id === null;
  const status = statusDisplay(account.status);

  // One clock for the whole render. Recomputing `new Date()` per figure is
  // how a trial reads "3 days" in one place and "2 days" in another.
  const now = new Date();

  const [prices, facts, history] = await Promise.all([
    tierPriceLabels(),
    isComped
      ? Promise.resolve(null)
      : subscriptionFacts(account.stripe_subscription_id, tier),
    isComped
      ? Promise.resolve(null)
      : billingHistory(account.stripe_customer_id),
  ]);

  const pendingTier = facts?.pendingTier ?? null;

  // The trial end this screen states: Stripe's, when we could read it,
  // falling back to the column the webhook wrote. They agree in normal
  // operation; when they don't, Stripe is the one charging the card.
  const trialEndsAt = facts?.trialEndIso ?? account.trial_ends_at;

  const notice = renewalNotice(
    {
      status: account.status,
      cancelAtPeriodEnd: facts?.cancelAtPeriodEnd ?? false,
      periodEndIso: facts?.periodEndIso ?? null,
      trialEndsAtIso: trialEndsAt,
    },
    now
  );
  const noticeText =
    notice.kind === "none"
      ? null
      : renewalText(notice, notice.dateIso ? formatDate(notice.dateIso) : "the renewal date");

  const matrix = marketingMatrix();

  return (
    <PageShell
      title="Billing"
      subtitle="Your plan, what it includes, what you're next charged, and your receipts."
    >
      {/* WHY THIS CALLOUT AND THE CARD BELOW NO LONGER SAY THE SAME
          THING. `status.meaning` explains the badge, and the badge is in
          the Card — so that is where the explanation belongs and where it
          stays. This banner exists for a different reason: it is where a
          REFUSED WRITE lands (requireAccount's READ_ONLY_REDIRECT), and
          repeating the Card's paragraph verbatim ~200px above it made the
          screen read as a template on the one state where it matters
          most. So it says why the pilot is here and where to go next, and
          nothing the Card already says. */}
      {readOnly ? (
        <Callout.Root color="amber">
          <Callout.Text>
            {state === "read-only"
              ? "The change you just tried needs an active subscription. This account is read-only until it's resubscribed — every record stays viewable and exportable in the meantime. Pick a plan below to start making changes again."
              : "This account is read-only. Every record stays viewable and exportable; pick a plan below to start making changes again."}
          </Callout.Text>
        </Callout.Root>
      ) : null}

      {/* `changed || pendingTier`, not `changed` alone. `pendingTier` is a
          live Stripe fact — "Stripe has already switched the price and our
          webhook has not landed yet" — and it is true however the pilot
          arrived. Gating on the query param alone hid the notice on
          exactly the navigation its own copy ("Refresh to see it")
          invites, and on a plan changed from Stripe's own portal, which
          never sets the param at all. */}
      {changed || pendingTier ? (
        <Callout.Root color={pendingTier ? "blue" : "green"}>
          <Callout.Text>
            {pendingTier
              ? `Stripe has confirmed your switch to ${TIER_DISPLAY[pendingTier].name}. It takes effect here the moment Stripe's confirmation event arrives — usually within seconds. Refresh to see it.`
              : changed === "cancel"
                ? "Cancellation scheduled with Stripe. Nothing changes until the date below, and you can resume any time before it."
                : changed === "resume"
                  ? "Cancellation withdrawn. Your subscription renews as normal."
                  : "Plan change confirmed with Stripe."}
          </Callout.Text>
        </Callout.Root>
      ) : null}

      {/* ------------------------------------------------- current plan */}
      <Card>
        <Flex direction="column" gap="3" p="1">
          <Flex align="center" gap="2" wrap="wrap">
            <Heading as="h2" size="5" trim="start">
              {TIER_DISPLAY[tier].name}
            </Heading>
            <Badge color={status.tone}>{status.label}</Badge>
            {facts?.interval ? (
              <Badge color="gray">
                {facts.interval === "monthly" ? "Monthly" : "Annual"} billing
              </Badge>
            ) : null}
            {facts?.cancelAtPeriodEnd ? <Badge color="amber">Cancels</Badge> : null}
          </Flex>

          <Text size="2" color="gray">
            {status.meaning}
          </Text>

          {noticeText ? (
            <Text size="2" color={notice.tone} weight={notice.tone === "gray" ? undefined : "medium"}>
              {noticeText}
            </Text>
          ) : null}

          {isComped ? (
            <Text size="2" color="gray">
              This account isn&rsquo;t billed through Stripe — its plan is managed for
              you, so there&rsquo;s nothing to change here.
            </Text>
          ) : (
            <>
              <Separator size="4" />

              {/* THE FACTS FROM STRIPE. Every row is omitted rather than
                  guessed when Stripe couldn't be read — a "—" here would
                  read as "you have no card on file", which is a different
                  and much more alarming statement. */}
              <DataList.Root
                size="2"
                orientation={{ initial: "vertical", sm: "horizontal" }}
              >
                <DataList.Item>
                  <DataList.Label minWidth="160px">Includes</DataList.Label>
                  <DataList.Value>{TIER_DISPLAY[tier].blurb}</DataList.Value>
                </DataList.Item>
                {/* GATED ON THE STATUS, NOT JUST ON STRIPE ANSWERING.
                    subscriptionFacts computes renewalLabel from the item's
                    price × quantity and periodEndIso from the item for ANY
                    retrievable subscription, a canceled or unpaid one
                    included — so ungated these two rows printed "Next
                    charge $29/month" and "Renews <a date in the past>"
                    directly under the red Canceled badge and the sentence
                    saying the subscription has ended. renewalNotice
                    (lib/billing-state.ts) already refuses to speak for a
                    non-writable status; these rows now make the same
                    call. A pending cancellation is writable but will not
                    be charged again either, so "Next charge" drops there
                    too and the date row says "Ends". */}
                {facts?.renewalLabel &&
                statusIsWritable(account.status) &&
                !facts.cancelAtPeriodEnd ? (
                  <DataList.Item>
                    <DataList.Label minWidth="160px">Next charge</DataList.Label>
                    <DataList.Value>
                      <Text className="tnum">{facts.renewalLabel}</Text>
                    </DataList.Value>
                  </DataList.Item>
                ) : null}
                {facts?.periodEndIso ? (
                  <DataList.Item>
                    <DataList.Label minWidth="160px">
                      {!statusIsWritable(account.status)
                        ? "Ended"
                        : facts.cancelAtPeriodEnd
                          ? "Ends"
                          : "Renews"}
                    </DataList.Label>
                    <DataList.Value>
                      <Text className="tnum">{formatDate(facts.periodEndIso)}</Text>
                    </DataList.Value>
                  </DataList.Item>
                ) : null}
                {typeof facts?.quantity === "number" ? (
                  <DataList.Item>
                    <DataList.Label minWidth="160px">Seats billed</DataList.Label>
                    <DataList.Value>
                      <Text className="tnum">{facts.quantity}</Text>
                    </DataList.Value>
                  </DataList.Item>
                ) : null}
                {facts?.card ? (
                  <DataList.Item>
                    <DataList.Label minWidth="160px">Card on file</DataList.Label>
                    <DataList.Value>
                      <Text className="tnum">
                        {`${facts.card.brand} ending ${facts.card.last4} · expires ${String(
                          facts.card.expMonth
                        ).padStart(2, "0")}/${facts.card.expYear}`}
                      </Text>
                    </DataList.Value>
                  </DataList.Item>
                ) : null}
              </DataList.Root>

              {facts && !facts.ok ? (
                <Text size="1" color="amber">
                  {STRIPE_UNREACHABLE}
                </Text>
              ) : facts && !facts.hasSubscription ? (
                // Read fine; there is simply no subscription attached.
                // Saying "Stripe is unreachable" here would be a different
                // and wrong claim.
                <Text size="1" color="gray">
                  There&rsquo;s no active subscription attached to this account yet, so
                  there&rsquo;s no renewal date or card to show. Pick a plan below.
                </Text>
              ) : null}

              <Text size="1" color="gray">
                Plan changes are confirmed with Stripe first and take effect here on
                Stripe&rsquo;s confirmation — the same path your subscription itself
                arrives by.
              </Text>
              {!canEdit ? (
                <Text size="1" color="gray">
                  Only the account owner can change the plan or billing details.
                </Text>
              ) : null}
            </>
          )}
        </Flex>
      </Card>

      {!isComped ? (
        <>
          {/* ------------------------------------------------ plan cards */}
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
              const otherInterval: BillingInterval | null =
                facts?.interval === "monthly"
                  ? "annual"
                  : facts?.interval === "annual"
                    ? "monthly"
                    : null;
              const otherIntervalPrice = otherInterval
                ? prices[planTier][otherInterval]
                : null;

              return (
                <Card key={planTier} variant={isCurrent ? "classic" : "surface"}>
                  <Flex direction="column" gap="2" p="1" height="100%">
                    <Flex align="center" justify="between" gap="2">
                      <Text weight="bold" size="4">
                        {TIER_DISPLAY[planTier].name}
                      </Text>
                      {isCurrent ? <Badge color="blue">Current plan</Badge> : null}
                    </Flex>
                    {/* chargeLabel, not label: for Business this is the
                        ×2 total ("$78/month"), which is what an upgrade to
                        Business actually bills now that changePlan sets
                        quantity to the two-seat minimum (Finding 1 + 2). */}
                    <Text size="2" color="gray" className="tnum">
                      {monthly ? monthly.chargeLabel : "—"}
                      {annual ? ` · ${annual.chargeLabel}` : ""}
                    </Text>
                    {monthly?.seatNote ? (
                      <Text size="1" color="gray">
                        {monthly.seatNote}
                      </Text>
                    ) : null}
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
                            label={`Switch to ${otherInterval} billing — ${otherIntervalPrice.chargeLabel}`}
                            disabled={!canEdit}
                          />
                        ) : null
                      ) : (
                        <ChangePlanButtons
                          tier={planTier}
                          direction={direction}
                          monthlyLabel={monthly?.chargeLabel ?? null}
                          annualLabel={annual?.chargeLabel ?? null}
                          disabled={!canEdit}
                        />
                      )}
                    </Flex>
                  </Flex>
                </Card>
              );
            })}
          </Grid>

          {/* ----------------------------------------- feature comparison */}
          <Card>
            <Flex direction="column" gap="2" p="1">
              <Text weight="bold" size="3">
                What each plan includes
              </Text>
              <Text size="2" color="gray">
                Every row below is read from the same table the app enforces against, so
                this cannot drift from what your plan actually opens. Your plan&rsquo;s
                column is marked.
              </Text>
              <Table.Root variant="surface" size="1">
                {/* VisuallyHidden is a Radix COMPONENT (inline styles);
                    there is no `rt-VisuallyHidden` class in its
                    stylesheet, so that className rendered the caption as
                    visible centred text above the table. */}
                <caption>
                  <VisuallyHidden>Features included in each plan</VisuallyHidden>
                </caption>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>Feature</Table.ColumnHeaderCell>
                    {PLAN_TIERS.map((planTier) => (
                      <Table.ColumnHeaderCell key={planTier} justify="center">
                        <Flex align="center" justify="center" gap="1" wrap="wrap">
                          {TIER_DISPLAY[planTier].name}
                          {planTier === tier ? <Badge color="blue">Yours</Badge> : null}
                        </Flex>
                      </Table.ColumnHeaderCell>
                    ))}
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {matrix.map((row) => (
                    <Table.Row key={row.feature}>
                      <Table.RowHeaderCell>
                        <Text size="2">{row.label}</Text>
                        {row.comingSoon ? (
                          <Text size="1" color="gray">
                            {" "}
                            (coming soon)
                          </Text>
                        ) : null}
                      </Table.RowHeaderCell>
                      {PLAN_TIERS.map((planTier) => (
                        <Table.Cell key={planTier} justify="center">
                          {/* A word, not a tick glyph: a screen reader
                              reading a row of unlabelled check marks
                              conveys nothing, and "—" and "✓" look
                              identical at a glance in a dense table. */}
                          <Text
                            size="1"
                            color={row.availability[planTier] ? "green" : "gray"}
                          >
                            {row.availability[planTier] ? "Included" : "—"}
                          </Text>
                        </Table.Cell>
                      ))}
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Flex>
          </Card>

          {/* ------------------------------------------------ downgrading */}
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

          {/* --------------------------------------- receipts and payment */}
          <Grid columns={{ initial: "1", md: "2" }} gap="4">
            <Card>
              <Flex direction="column" gap="2" p="1">
                <Text weight="bold" size="3">
                  Receipts
                </Text>
                {history && !history.ok ? (
                  <Text size="2" color="amber">
                    Couldn&rsquo;t load your receipts just now. This is not a statement
                    that you have none — the full archive is always in the billing
                    portal.
                  </Text>
                ) : history && history.rows.length === 0 ? (
                  // Through EmptyState, like every other empty region in
                  // the product: a heading that lands in the outline, one
                  // sentence, and a way out. The error branch above is
                  // deliberately NOT routed through it — a failed read is
                  // not an empty state (see components/ui/empty-state.tsx).
                  <EmptyState
                    title="No invoices yet"
                    action={<BillingPortalButton disabled={!canEdit} />}
                  >
                    Receipts appear here once Stripe has charged you — the first one
                    after your trial converts. The billing portal always holds the
                    full archive.
                  </EmptyState>
                ) : (
                  <Table.Root variant="ghost" size="1">
                    <caption>
                      <VisuallyHidden>Recent invoices</VisuallyHidden>
                    </caption>
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Invoice</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell justify="end">
                          Amount
                        </Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {(history?.rows ?? []).map((row) => (
                        <Table.Row key={row.id}>
                          <Table.Cell>
                            <Text size="1" className="tnum">
                              {formatDate(row.createdIso)}
                            </Text>
                          </Table.Cell>
                          <Table.Cell>
                            {row.hostedUrl ? (
                              <RadixLink
                                href={row.hostedUrl}
                                size="1"
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {row.number}
                              </RadixLink>
                            ) : (
                              <Text size="1" color="gray">
                                {row.number}
                              </Text>
                            )}
                          </Table.Cell>
                          <Table.Cell justify="end">
                            <Text size="1" className="tnum">
                              {row.amountLabel ?? "—"}
                            </Text>
                          </Table.Cell>
                          <Table.Cell>
                            <Text size="1" color="gray">
                              {row.status}
                            </Text>
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Root>
                )}
                <Text size="1" color="gray">
                  Invoice numbers link to Stripe&rsquo;s hosted receipt, where the PDF
                  is. Older invoices than these are in the portal.
                </Text>
              </Flex>
            </Card>

            <Card>
              <Flex direction="column" gap="2" p="1">
                <Text weight="bold" size="3">
                  Payment details
                </Text>
                <Text size="2" color="gray">
                  Your card, your billing address, and the full invoice archive are
                  handled in Stripe&rsquo;s secure billing portal — we never see your
                  card number.
                </Text>
                <Flex>
                  <BillingPortalButton disabled={!canEdit} />
                </Flex>

                <Separator size="4" my="2" />

                <Text weight="bold" size="3">
                  {facts?.cancelAtPeriodEnd ? "Resume" : "Cancel"}
                </Text>
                <Text size="2" color="gray">
                  {facts?.cancelAtPeriodEnd
                    ? "Your subscription is set to end at the close of the current period. Resuming withdraws that — no new charge, no gap, and the date above goes back to being a renewal."
                    : "Cancelling stops the NEXT charge. You keep everything you've paid for until the end of the current period, and after that the account goes read-only: every record stays viewable and exportable, and nothing is deleted."}
                </Text>
                <CancelResumeButton
                  cancelling={facts?.cancelAtPeriodEnd ?? false}
                  // Refused unless we actually READ the flag this button
                  // inverts. Offering it on a guess could send exactly the
                  // opposite instruction to the one its label promises.
                  disabled={!canEdit || !facts?.ok || !facts.hasSubscription}
                />
                {facts && !facts.ok ? (
                  <Text size="1" color="amber">
                    Cancel and resume are unavailable while we can&rsquo;t read your
                    subscription from Stripe. Use the billing portal above.
                  </Text>
                ) : null}
              </Flex>
            </Card>
          </Grid>

          <Text size="1" color="gray">
            Changing what your own clients pay you is a different thing entirely —
            that&rsquo;s in{" "}
            <RadixLink asChild>
              <NextLink href="/settings">Settings</NextLink>
            </RadixLink>
            , under your business details.
          </Text>
        </>
      ) : null}
    </PageShell>
  );
}
