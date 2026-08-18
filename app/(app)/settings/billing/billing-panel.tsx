import NextLink from "next/link";
import {
  LAlert,
  LCard,
  LEmpty,
  LPill,
  LRow,
  LRows,
  LSeparator,
  LTable,
  LTd,
  LTh,
} from "@/components/ledger";
import { cn } from "@/lib/ledger/cn";
import { accountIsReadOnly, requireAccount } from "@/lib/supabase/account";
import {
  FEATURES,
  PLAN_TIERS,
  TIER_DISPLAY,
  TIER_RANK,
  featuresAddedByTier,
  marketingMatrix,
  type BillingInterval,
  type PlanTier,
} from "@/lib/entitlements";
import { isCurrencyEngineEnabled } from "@/lib/currency/gate";
import { visibleDowngradeNote } from "./downgrade-note";
import {
  renewalNotice,
  renewalText,
  statusDisplay,
  statusIsWritable,
  type StatusTone,
} from "@/lib/billing-state";
import { tierPriceLabels } from "@/lib/stripe/prices";
import { billingHistory, subscriptionFacts } from "@/lib/stripe/billing-facts";
import { checkPriceDrift, describeMismatch } from "@/lib/stripe/price-drift";
import { formatDate } from "@/lib/format";
import {
  BillingPortalButton,
  CancelResumeButton,
  ChangePlanButtons,
  ResubscribeButtons,
  SwitchIntervalButton,
} from "./billing-buttons";
import { DemoCancelResumeButton, DemoChangePlanButton } from "./demo-buttons";

/**
 * PLAN MANAGEMENT — the shared body of the billing surface, rendered from
 * two places: the standalone `/settings/billing` route (billing/page.tsx,
 * the redirect target every action in billing/actions.ts lands on and
 * still the page a bookmark or a Stripe portal return_url points at) and
 * the "Billing" tab in the main Settings tab strip (settings/page.tsx via
 * settings-tabs.tsx), so a pilot can glance at or change their plan
 * without leaving Settings. Extracted rather than duplicated so the two
 * call sites can never drift onto two different billing stories.
 *
 * What this may and may not do is fixed by the platform-billing rules the
 * webhook already enforces, and none of the depth here bends them:
 *
 *   - THE TIER ON RECORD IS pilot.accounts.plan_tier, written by the
 *     Stripe webhook and by nothing else. This panel reads Stripe only so
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
 *     A lapsed account must be able to load this panel and resubscribe,
 *     from either call site.
 *
 * `changed`/`state` are the query-string flags billing/actions.ts's
 * redirects and requireAccount's read-only bounce set on
 * `/settings/billing` — the Billing-tab call site has neither (its own
 * URL is `/settings?tab=billing`), so both are simply undefined there and
 * every banner below stays quiet until a pilot lands here via an action.
 */

export type BillingPanelProps = {
  changed?: string;
  state?: string;
};

/** Which of the two Stripe reads a card depends on, said once. */
const STRIPE_UNREACHABLE =
  "We couldn't reach Stripe just now, so the details below are incomplete. This is not a statement about your subscription. Reload in a moment, or open the billing portal.";

/**
 * lib/billing-state.ts's StatusTone keeps INSTRUMENT's Badge colour
 * vocabulary (gray/blue/amber/green/red) as its own data. Same dictionary
 * as invoices/page.tsx's own statusToPillTone: red→crit, amber→warn,
 * green→good, gray→neutral, blue→accent.
 */
function toneToPillTone(tone: StatusTone): "crit" | "warn" | "good" | "neutral" | "accent" {
  switch (tone) {
    case "red":
      return "crit";
    case "amber":
      return "warn";
    case "green":
      return "good";
    case "blue":
      return "accent";
    default:
      return "neutral";
  }
}

function toneToTextClass(tone: StatusTone): string {
  switch (tone) {
    case "red":
      return "text-crit";
    case "amber":
      return "text-warn";
    case "green":
      return "text-good";
    case "blue":
      return "text-accent";
    default:
      return "text-ink-2";
  }
}

export default async function BillingPanel({ changed, state }: BillingPanelProps) {
  const { account, role } = await requireAccount("/settings/billing", {
    allowReadOnly: true,
  });
  const canEdit = role === "owner";
  const readOnly = accountIsReadOnly(account);

  const tier = account.plan_tier;
  const isComped = account.stripe_customer_id === null;
  const status = statusDisplay(account.status);
  // The two statuses whose Stripe subscription object is genuinely dead —
  // Stripe rejects subscriptions.update() on either one, so changePlan and
  // CancelResumeButton can never do anything here. Every OTHER read-only
  // status (past_due, unpaid, incomplete, paused) still has a live,
  // updatable subscription, so those keep the normal controls.
  const needsResubscribe =
    account.status === "canceled" || account.status === "incomplete_expired";

  // One clock for the whole render. Recomputing `new Date()` per figure is
  // how a trial reads "3 days" in one place and "2 days" in another.
  const now = new Date();

  const [prices, facts, history, drift] = await Promise.all([
    tierPriceLabels(),
    isComped
      ? Promise.resolve(null)
      : subscriptionFacts(account.stripe_subscription_id, tier),
    isComped
      ? Promise.resolve(null)
      : billingHistory(account.stripe_customer_id),
    // Owner-only: an extra round trip to Stripe on every render is only
    // worth paying for the one role who can act on what it finds, and the
    // one role docs/PRICING.md's drift risk actually concerns.
    canEdit
      ? checkPriceDrift()
      : Promise.resolve({
          checked: false as const,
          ok: true,
          mismatches: [],
          unconfigured: [],
          unreachable: [],
        }),
  ]);

  const pendingTier = facts?.pendingTier ?? null;

  // The trial end this panel states: Stripe's, when we could read it,
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

  // Display-honesty, not a gate change: with CURRENCY_ENGINE_ENABLED off
  // (the only permitted state), the currency board is unreachable
  // anywhere in the app — /currency refuses to render and the nav omits
  // it — so this in-app comparison table must not tell a paying
  // subscriber their plan includes it, exactly like the public pricing
  // page's PUBLIC_CLAIM_FILTER already does for the public matrix.
  const currencyVisible = isCurrencyEngineEnabled();
  const matrix = marketingMatrix().filter(
    (row) => currencyVisible || row.feature !== "currency"
  );

  return (
    <>
      {/* PRICE-DRIFT GUARD, OWNER-ONLY. lib/stripe/price-drift.ts compares
          the public pricing page's printed copy against the live Stripe
          Price the configured env var actually points at. This is an
          OPERATOR problem, not a billing-state one for this account, so it
          renders unconditionally when it fires — even for a comped
          account — because a misconfigured Price affects every future
          checkout regardless of what this one account is on. */}
      {drift.checked && !drift.ok ? (
        <LAlert tone="crit" className="flex flex-col gap-2">
          <p>
            <span className="font-semibold">
              Price configuration drift: the public pricing page and the
              configured Stripe Price(s) disagree.
            </span>{" "}
            Checkout would charge a different amount than the pricing page shows.
            This is visible to the account owner only. Fix the STRIPE_PRICE_ID_*
            env var(s) or the Stripe Price object before a pilot checks out.
          </p>
          <div className="flex flex-col gap-1">
            {drift.mismatches.map((m) => (
              <p key={`${m.tier}-${m.interval}`} className="tnum-l text-caption">
                {describeMismatch(m)}
              </p>
            ))}
          </div>
        </LAlert>
      ) : null}

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
        <LAlert tone="warn">
          {state === "read-only"
            ? "The change you just tried needs an active subscription. This account is read-only until it's resubscribed. Every record stays viewable and exportable in the meantime. Pick a plan below to start making changes again."
            : "This account is read-only. Every record stays viewable and exportable. Pick a plan below to start making changes again."}
        </LAlert>
      ) : null}

      {/* `changed || pendingTier`, not `changed` alone. `pendingTier` is a
          live Stripe fact — "Stripe has already switched the price and our
          webhook has not landed yet" — and it is true however the pilot
          arrived. Gating on the query param alone hid the notice on
          exactly the navigation its own copy ("Refresh to see it")
          invites, and on a plan changed from Stripe's own portal, which
          never sets the param at all. */}
      {changed || pendingTier ? (
        <LAlert tone={pendingTier ? "accent" : "good"}>
          {pendingTier
            ? `Stripe has confirmed your switch to ${TIER_DISPLAY[pendingTier].name}. It takes effect here the moment Stripe's confirmation event arrives, usually within seconds. Refresh to see it.`
            : changed === "cancel"
              ? "Cancellation scheduled with Stripe. Nothing changes until the date below, and you can resume any time before it."
              : changed === "resume"
                ? "Cancellation withdrawn. Your subscription renews as normal."
                : "Plan change confirmed with Stripe."}
        </LAlert>
      ) : null}

      {/* ------------------------------------------------- current plan */}
      <LCard>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-h2 font-bold tracking-tight">{TIER_DISPLAY[tier].name}</h2>
            <LPill tone={toneToPillTone(status.tone)}>{status.label}</LPill>
            {isComped ? <LPill tone="neutral">Demo</LPill> : null}
            {facts?.interval ? (
              <LPill tone="neutral">
                {facts.interval === "monthly" ? "Monthly" : "Annual"} billing
              </LPill>
            ) : null}
            {facts?.cancelAtPeriodEnd || (isComped && account.demo_cancel_at_period_end) ? (
              <LPill tone="warn">Cancels</LPill>
            ) : null}
          </div>

          <p className="text-body-s text-ink-2">{status.meaning}</p>

          {noticeText ? (
            <p className={cn("text-body-s font-medium", toneToTextClass(notice.tone))}>
              {noticeText}
            </p>
          ) : null}

          {isComped ? (
            <p className="text-body-s text-ink-2">
              This account isn&rsquo;t billed through Stripe — it&rsquo;s a demo of what a
              real subscriber sees. Switching plans and cancelling/resuming below work
              instantly and never touch Stripe or create a charge.
            </p>
          ) : (
            <>
              <LSeparator />

              {/* THE FACTS FROM STRIPE. Every row is omitted rather than
                  guessed when Stripe couldn't be read — a "—" here would
                  read as "you have no card on file", which is a different
                  and much more alarming statement. */}
              <LRows>
                <LRow>
                  <span className="text-caption text-ink-3">Includes</span>
                  <span className="text-body-s">{TIER_DISPLAY[tier].blurb}</span>
                </LRow>
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
                  <LRow>
                    <span className="text-caption text-ink-3">Next charge</span>
                    <span className="tnum-l text-body-s">{facts.renewalLabel}</span>
                  </LRow>
                ) : null}
                {facts?.periodEndIso ? (
                  <LRow>
                    <span className="text-caption text-ink-3">
                      {!statusIsWritable(account.status)
                        ? "Ended"
                        : facts.cancelAtPeriodEnd
                          ? "Ends"
                          : "Renews"}
                    </span>
                    <span className="tnum-l text-body-s">{formatDate(facts.periodEndIso)}</span>
                  </LRow>
                ) : null}
                {typeof facts?.quantity === "number" ? (
                  <LRow>
                    <span className="text-caption text-ink-3">Seats billed</span>
                    <span className="tnum-l text-body-s">{facts.quantity}</span>
                  </LRow>
                ) : null}
                {facts?.card ? (
                  <LRow>
                    <span className="text-caption text-ink-3">Card on file</span>
                    <span className="tnum-l text-body-s">
                      {`${facts.card.brand} ending ${facts.card.last4} · expires ${String(
                        facts.card.expMonth
                      ).padStart(2, "0")}/${facts.card.expYear}`}
                    </span>
                  </LRow>
                ) : null}
              </LRows>

              {facts && !facts.ok ? (
                <p className="text-caption text-warn">{STRIPE_UNREACHABLE}</p>
              ) : facts && !facts.hasSubscription ? (
                // Read fine; there is simply no subscription attached.
                // Saying "Stripe is unreachable" here would be a different
                // and wrong claim.
                <p className="text-caption text-ink-3">
                  There&rsquo;s no active subscription attached to this account yet, so
                  there&rsquo;s no renewal date or card to show. Pick a plan below.
                </p>
              ) : null}

              <p className="text-caption text-ink-3">
                Plan changes are confirmed with Stripe first and take effect here on
                Stripe&rsquo;s confirmation, the same path your subscription itself
                arrives by.
              </p>
              {!canEdit ? (
                <p className="text-caption text-ink-3">
                  Only the account owner can change the plan or billing details.
                </p>
              ) : null}
            </>
          )}
        </div>
      </LCard>

      {/* Plan cards, the feature table and the downgrade note all render
          for a comped/demo account too — that IS the demo. Only the
          receipts/payment-details section below is real-Stripe-only (a
          comped account has no invoices and no card on file, so there is
          nothing there to show even in simulation). */}
      <>
          {/* ------------------------------------------------ plan cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {PLAN_TIERS.map((planTier) => {
              const isCurrent = planTier === tier;
              const direction: "Upgrade" | "Downgrade" =
                TIER_RANK[planTier] > TIER_RANK[tier] ? "Upgrade" : "Downgrade";
              const added = featuresAddedByTier(planTier).filter(
                (feature) => currencyVisible || feature !== "currency"
              );
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
                <LCard
                  key={planTier}
                  className={cn(isCurrent && "border-accent")}
                >
                  <div className="flex h-full flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-h3 font-semibold">
                        {TIER_DISPLAY[planTier].name}
                      </h3>
                      {isCurrent ? <LPill tone="accent">Current plan</LPill> : null}
                    </div>
                    {/* chargeLabel, not label: for Business this is the
                        ×2 total ("$78/month"), which is what an upgrade to
                        Business actually bills now that changePlan sets
                        quantity to the two-seat minimum (Finding 1 + 2). */}
                    <p className="tnum-l text-body-s text-ink-2">
                      {monthly ? monthly.chargeLabel : "—"}
                      {annual ? ` · ${annual.chargeLabel}` : ""}
                    </p>
                    {monthly?.seatNote ? (
                      <p className="text-caption text-ink-3">{monthly.seatNote}</p>
                    ) : null}
                    <p className="text-body-s text-ink-2">{TIER_DISPLAY[planTier].blurb}</p>
                    <div className="mt-1 flex flex-1 flex-col gap-1">
                      {previousTier ? (
                        <p className="text-caption font-semibold text-ink-3">
                          Everything in {TIER_DISPLAY[previousTier].name}, plus:
                        </p>
                      ) : (
                        <p className="text-caption font-semibold text-ink-3">Includes:</p>
                      )}
                      {added.map((feature) => (
                        <p className="text-caption text-ink-3" key={feature}>
                          &bull; {FEATURES[feature].label}
                          {FEATURES[feature].comingSoon ? " (coming soon)" : ""}
                        </p>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-col gap-2">
                      {isComped ? (
                        // DEMO PATH. No interval, no resubscribe concept —
                        // a comped account has no Stripe subscription to be
                        // monthly/annual about or to let lapse. One button,
                        // writing plan_tier directly through demo-actions.ts
                        // (service-role, re-verified stripe_customer_id IS
                        // NULL server-side); see that file's header.
                        isCurrent ? null : (
                          <DemoChangePlanButton
                            tier={planTier}
                            direction={direction}
                            label={`${direction} (demo)`}
                            disabled={!canEdit}
                          />
                        )
                      ) : needsResubscribe ? (
                        // No live subscription to switch or update — every
                        // card, including the one matching the tier on
                        // record, offers a fresh Checkout session instead.
                        <ResubscribeButtons
                          tier={planTier}
                          monthlyLabel={monthly?.chargeLabel ?? null}
                          annualLabel={annual?.chargeLabel ?? null}
                          disabled={!canEdit}
                        />
                      ) : isCurrent ? (
                        otherInterval && otherIntervalPrice ? (
                          <SwitchIntervalButton
                            tier={planTier}
                            targetInterval={otherInterval}
                            label={`Switch to ${otherInterval} billing: ${otherIntervalPrice.chargeLabel}`}
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
                    </div>
                  </div>
                </LCard>
              );
            })}
          </div>

          {/* ----------------------------------------- feature comparison */}
          <LCard>
            <div className="flex flex-col gap-2">
              <h3 className="text-h3 font-semibold">What each plan includes</h3>
              <p className="text-body-s text-ink-2">
                Every row below is read from the same table the app enforces against, so
                this cannot drift from what your plan actually opens. Your plan&rsquo;s
                column is marked.
              </p>
              <LTable>
                <caption>
                  <span className="sr-only">Features included in each plan</span>
                </caption>
                <thead>
                  <tr>
                    <LTh>Feature</LTh>
                    {PLAN_TIERS.map((planTier) => (
                      <LTh key={planTier} className="text-center">
                        <span className="inline-flex flex-wrap items-center justify-center gap-1">
                          {TIER_DISPLAY[planTier].name}
                          {planTier === tier ? <LPill tone="accent">Yours</LPill> : null}
                        </span>
                      </LTh>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((row) => (
                    <tr key={row.feature}>
                      <th
                        scope="row"
                        className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                      >
                        {row.label}
                        {row.comingSoon ? (
                          <span className="text-caption text-ink-3"> (coming soon)</span>
                        ) : null}
                      </th>
                      {PLAN_TIERS.map((planTier) => (
                        <LTd key={planTier} className="text-center">
                          {/* A word, not a tick glyph: a screen reader
                              reading a row of unlabelled check marks
                              conveys nothing, and "—" and "✓" look
                              identical at a glance in a dense table. */}
                          <span
                            className={cn(
                              "text-caption",
                              row.availability[planTier] ? "text-good" : "text-ink-3"
                            )}
                          >
                            {row.availability[planTier] ? "Included" : "—"}
                          </span>
                        </LTd>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </LTable>
            </div>
          </LCard>

          {/* ------------------------------------------------ downgrading */}
          <LCard>
            <div className="flex flex-col gap-2">
              <h3 className="text-h3 font-semibold">Downgrading</h3>
              <p className="text-body-s text-ink-2">{visibleDowngradeNote()}</p>
            </div>
          </LCard>

          {/* ------------------------------------ cancel/resume, demo path */}
          {isComped ? (
            <LCard>
              <div className="flex flex-col gap-2">
                <h3 className="text-h3 font-semibold">
                  {account.demo_cancel_at_period_end ? "Resume" : "Cancel"} (demo)
                </h3>
                <p className="text-body-s text-ink-2">
                  {account.demo_cancel_at_period_end
                    ? "This demo account is set to show as cancelled. Resuming clears that — no Stripe subscription exists to actually renew or lapse."
                    : "This account isn't billed through Stripe, so nothing is actually charged or cancelled here — this flips the same \"Cancels\" state a real subscriber's cancellation shows, so the screen can be demoed end to end."}
                </p>
                <DemoCancelResumeButton
                  cancelling={account.demo_cancel_at_period_end}
                  disabled={!canEdit}
                />
              </div>
            </LCard>
          ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <LCard>
              <div className="flex flex-col gap-2">
                <h3 className="text-h3 font-semibold">Receipts</h3>
                {history && !history.ok ? (
                  <p className="text-body-s text-warn">
                    Couldn&rsquo;t load your receipts just now. This is not a statement
                    that you have none. The full archive is always in the billing
                    portal.
                  </p>
                ) : history && history.rows.length === 0 ? (
                  // Through LEmpty, like every other empty region on
                  // Ledger: a heading that lands in the outline, one
                  // sentence, and a way out. The error branch above is
                  // deliberately NOT routed through it — a failed read is
                  // not an empty state.
                  <LEmpty title="No invoices yet" action={<BillingPortalButton disabled={!canEdit} />}>
                    Receipts appear here once Stripe has charged you, starting with the
                    first one after your trial converts. The billing portal always holds
                    the full archive.
                  </LEmpty>
                ) : (
                  <LTable>
                    <caption>
                      <span className="sr-only">Recent invoices</span>
                    </caption>
                    <thead>
                      <tr>
                        <LTh>Date</LTh>
                        <LTh>Invoice</LTh>
                        <LTh numeric>Amount</LTh>
                        <LTh>Status</LTh>
                      </tr>
                    </thead>
                    <tbody>
                      {(history?.rows ?? []).map((row) => (
                        <tr key={row.id}>
                          <LTd>
                            <span className="tnum-l">{formatDate(row.createdIso)}</span>
                          </LTd>
                          <LTd>
                            {row.hostedUrl ? (
                              <a
                                href={row.hostedUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent hover:underline"
                              >
                                {row.number}
                              </a>
                            ) : (
                              <span className="text-ink-3">{row.number}</span>
                            )}
                          </LTd>
                          <LTd numeric>{row.amountLabel ?? "—"}</LTd>
                          <LTd>
                            <span className="text-ink-2">{row.status}</span>
                          </LTd>
                        </tr>
                      ))}
                    </tbody>
                  </LTable>
                )}
                <p className="text-caption text-ink-3">
                  Invoice numbers link to Stripe&rsquo;s hosted receipt, where the PDF
                  is. Older invoices than these are in the portal.
                </p>
              </div>
            </LCard>

            <LCard>
              <div className="flex flex-col gap-2">
                <h3 className="text-h3 font-semibold">Payment details</h3>
                <p className="text-body-s text-ink-2">
                  Your card, your billing address, and the full invoice archive are
                  handled in Stripe&rsquo;s secure billing portal. We never see your
                  card number.
                </p>
                <div>
                  <BillingPortalButton disabled={!canEdit} />
                </div>

                <LSeparator />

                <p className="text-lead font-bold">
                  {facts?.cancelAtPeriodEnd ? "Resume" : "Cancel"}
                </p>
                <p className="text-body-s text-ink-2">
                  {facts?.cancelAtPeriodEnd
                    ? "Set to end at the close of this period. Resuming withdraws that: no new charge, no gap, and the date above becomes a renewal again."
                    : "Cancelling stops the next charge; you keep what you've paid for through the period. Then the account goes read-only: everything stays viewable and exportable, and nothing is deleted."}
                </p>
                <CancelResumeButton
                  cancelling={facts?.cancelAtPeriodEnd ?? false}
                  // Refused unless we actually READ the flag this button
                  // inverts. Offering it on a guess could send exactly the
                  // opposite instruction to the one its label promises.
                  // Also refused once the subscription itself is dead
                  // (canceled/incomplete_expired) — Stripe rejects an
                  // update to either, so the button would always error;
                  // ResubscribeButtons above is the working path from here.
                  disabled={
                    !canEdit || !facts?.ok || !facts.hasSubscription || needsResubscribe
                  }
                />
                {facts && !facts.ok ? (
                  <p className="text-caption text-warn">
                    Cancel and resume are unavailable while we can&rsquo;t read your
                    subscription from Stripe. Use the billing portal above.
                  </p>
                ) : needsResubscribe ? (
                  <p className="text-caption text-ink-3">
                    This subscription has ended, so there&rsquo;s nothing to cancel or
                    resume. Pick a plan above to resubscribe.
                  </p>
                ) : null}
              </div>
            </LCard>
          </div>
          )}

          <p className="text-caption text-ink-3">
            Changing what your own clients pay you is a different thing entirely.
            That&rsquo;s in{" "}
            <NextLink href="/settings" className="text-accent hover:underline">
              Settings
            </NextLink>
            , under your business details.
          </p>
      </>
    </>
  );
}
