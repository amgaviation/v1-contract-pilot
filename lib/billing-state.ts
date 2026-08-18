/**
 * What a subscription's STATE means, in the product's own words — and the
 * two date sums the billing screen needs to say it.
 *
 * DELIBERATELY PURE, for the same reasons lib/entitlements.ts is: no
 * imports beyond that file's types, no "server-only", no I/O, no Date.now()
 * captured at module scope. `now` is always a parameter, so the unit suite
 * (tests/billing-state.test.mjs) exercises the real module against fixed
 * clocks rather than whatever today happens to be.
 *
 * WHAT LIVES HERE AND WHY IT IS NOT IN entitlements.ts: entitlements.ts is
 * the TIER vocabulary — what a plan includes. This is the SUBSCRIPTION
 * vocabulary — what a plan is currently doing. They move for different
 * reasons (a tier rename is a marketing decision; a status label is a
 * Stripe-lifecycle decision), and the billing screen is the only surface
 * that needs both.
 *
 * WHAT THIS FILE NEVER CONTAINS: a dollar amount. Every figure on the
 * billing screen comes from a live Stripe object through
 * lib/stripe/prices.ts and lib/stripe/billing-facts.ts. This file deals in
 * dates, counts and sentences only.
 */

import {
  ACCOUNT_WRITABLE_STATUSES,
  TIER_RANK,
  accountIsReadOnly,
  type PlanTier,
} from "./entitlements";

/**
 * The full `pilot.accounts.status` CHECK, in the order the Phase-1
 * migration pins it. Enumerated here (rather than inferred) so a status
 * Stripe starts sending that this product has never seen still lands on
 * the total fallback in statusDisplay() instead of rendering `undefined`.
 */
export const ACCOUNT_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/**
 * A badge tone, as a plain string union rather than a Radix colour type —
 * this file stays import-free of the component layer, and the call site
 * passes it straight to `<Badge color={…}>`. Named `tone`, not `color`,
 * for the same reason app/(app)/overview/page.tsx's EXPIRY_LADDER_BADGE is:
 * `color:` is a colour-bearing property name and this product's token
 * checker reads those.
 */
export type StatusTone = "green" | "blue" | "amber" | "red" | "gray";

export type StatusDisplay = {
  label: string;
  tone: StatusTone;
  /**
   * One sentence a pilot can act on. NOT a restatement of the label —
   * "Past due" is the label; "your last payment didn't go through" is what
   * it means. Read-only states say so explicitly, because the read-only
   * rule (ACCOUNT_WRITABLE_STATUSES, lib/entitlements.ts) is the single
   * most surprising thing this screen has to explain.
   */
  meaning: string;
};

const STATUS_DISPLAY: Record<AccountStatus, StatusDisplay> = {
  trialing: {
    label: "Trialing",
    tone: "blue",
    meaning:
      "You're inside your trial. Everything works; your card is charged when it ends.",
  },
  active: {
    label: "Active",
    tone: "green",
    meaning: "Your subscription is current and renews automatically.",
  },
  past_due: {
    label: "Past due",
    tone: "amber",
    meaning:
      "Your last payment didn't go through, so this account is read-only until it clears. Everything stays readable and exportable. Nothing is deleted. Update your card in the billing portal and Stripe will retry.",
  },
  canceled: {
    label: "Canceled",
    tone: "red",
    meaning:
      "This subscription has ended, so the account is read-only. Every record stays viewable and exportable. Resubscribe to start making changes again.",
  },
  unpaid: {
    label: "Unpaid",
    tone: "red",
    meaning:
      "Stripe has stopped retrying an unpaid invoice, so the account is read-only. Settle it in the billing portal to restore writing.",
  },
  incomplete: {
    label: "Incomplete",
    tone: "amber",
    meaning:
      "The first payment hasn't finished confirming (often a bank authentication step). The account is read-only until it does.",
  },
  incomplete_expired: {
    label: "Incomplete (expired)",
    tone: "red",
    meaning:
      "The first payment was never confirmed and the subscription expired, so the account is read-only. Start a new subscription to continue; nothing already recorded is deleted.",
  },
  paused: {
    label: "Paused",
    tone: "gray",
    // NOT "Resume it" — the billing screen's only resume-shaped control
    // (CancelResumeButton) flips cancel_at_period_end, a different Stripe
    // field, and does nothing for a paused subscription. The billing
    // portal is Stripe's own UI for pause_collection and is the one path
    // that actually works here.
    meaning:
      "This subscription is paused, so the account is read-only. Resume it from the billing portal below to start making changes again.",
  },
};

export function isAccountStatus(value: unknown): value is AccountStatus {
  return (ACCOUNT_STATUSES as readonly unknown[]).includes(value);
}

/**
 * Total: an unrecognised status is described honestly ("we don't have a
 * plain-English description for this one") rather than rendered raw or
 * crashed on. It is still shown, because hiding it would leave a pilot
 * with no explanation for a read-only account at all.
 */
export function statusDisplay(status: string): StatusDisplay {
  if (isAccountStatus(status)) return STATUS_DISPLAY[status];
  return {
    label: status,
    tone: "gray",
    meaning:
      "Stripe reports this subscription in a state this screen doesn't have a description for. Open the billing portal for the full picture, or get in touch.",
  };
}

/** True when this status may still write — the one rule, read from entitlements. */
export function statusIsWritable(status: string): boolean {
  return (ACCOUNT_WRITABLE_STATUSES as readonly string[]).includes(status);
}

export type ReadOnlyNotice = {
  /** The banner sentence — status-specific, never the one-size-fits-all line. */
  message: string;
  /** Where the fix lives for THIS state, not a generic destination. */
  href: string;
  linkLabel: string;
};

/**
 * The every-page read-only banner's content, or null when the account
 * writes normally.
 *
 * WHY THIS EXISTS: the shell used to render one hardcoded sentence —
 * "Your subscription has ended… Resubscribe" — for every read-only cause.
 * accountIsReadOnly() is true for six different states, and for most of
 * them that sentence was FALSE: past_due means Stripe is still retrying
 * the card (the fix is a card update, and resubscribe() refuses to run),
 * a hold is the pilot's own deliberate pause, and a deactivation was an
 * explicit choice made in Settings. The accurate per-status sentences
 * already lived in STATUS_DISPLAY above and were only ever read by the
 * Billing page; this function is how the global banner reads them too.
 *
 * Precedence mirrors accountIsReadOnly's own reasons: an explicit
 * deactivation outranks everything (status can still read 'active' in the
 * webhook gap — see entitlements.ts), then a hold (also 'active' at
 * Stripe, by pause_collection's design), then whatever the status means.
 */
export function readOnlyNotice(account: {
  status: string;
  deactivated_at?: string | null;
  hold_started_at?: string | null;
}): ReadOnlyNotice | null {
  if (!accountIsReadOnly(account)) return null;

  if (account.deactivated_at) {
    return {
      message:
        "This account has been deactivated, so it's read-only. Every record stays viewable and exportable.",
      href: "/settings?tab=account",
      linkLabel: "Go to Account settings",
    };
  }

  if (account.hold_started_at) {
    return {
      message:
        "This account is on hold, so it's read-only and billing is paused. Everything stays viewable and exportable. End the hold to pick up where you left off.",
      href: "/settings?tab=account",
      linkLabel: "Go to Account settings",
    };
  }

  return {
    message: statusDisplay(account.status).meaning,
    href: "/settings/billing",
    linkLabel: "Go to Billing",
  };
}

/**
 * True when a plan change must collect its proration NOW rather than let
 * it ride to the next invoice — a tier-rank increase, or a seat-count
 * increase within the same tier (Business 1→2+ seats). Both are cases
 * where "credit/charge on the next invoice" can mean charging nothing at
 * all: an annual plan's next invoice can be up to a year away, and
 * canceling at period end before that invoice ever fires drops the
 * pending proration item entirely. A downgrade or a flat interval switch
 * carries no such risk, so it keeps the ordinary next-invoice behavior
 * (settings/billing/actions.ts's changePlan is the caller).
 */
export function planChangeIsIncrease(
  currentTier: PlanTier,
  targetTier: PlanTier,
  currentQuantity: number,
  targetQuantity: number
): boolean {
  return TIER_RANK[targetTier] > TIER_RANK[currentTier] || targetQuantity > currentQuantity;
}

/**
 * Whole days from `now` to `iso`, rounded UP, or null when there is no
 * date to measure. Rounded up because a trial with eleven hours left is
 * "1 day", not "0 days" — a pilot reading "0 days left" on a trial that
 * still has an evening in it would reasonably think it had already ended.
 * A date already past returns 0, never a negative: "expired" is a
 * different sentence, decided by the caller, not a negative day count.
 */
export function daysUntil(
  iso: string | null | undefined,
  now: Date
): number | null {
  if (!iso) return null;
  const end = Date.parse(iso);
  if (Number.isNaN(end)) return null;
  const ms = end - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}

/**
 * Days left in a trial — null unless the account is ACTUALLY trialing.
 * Gated on the status, not just on the presence of trial_ends_at, because
 * that column is not cleared when a trial converts: an active subscriber
 * still carries the date their trial ended, and counting from it would
 * print "trial ends in 0 days" forever to a paying customer.
 */
export function trialDaysRemaining(
  status: string,
  trialEndsAt: string | null | undefined,
  now: Date
): number | null {
  if (status !== "trialing") return null;
  return daysUntil(trialEndsAt, now);
}

export type RenewalFacts = {
  status: string;
  /** Stripe's `cancel_at_period_end`. Unknown (Stripe unreachable) is false. */
  cancelAtPeriodEnd: boolean;
  /**
   * ISO instant the current billing period ends — from the subscription
   * ITEM in this API version, not the subscription. Null when Stripe could
   * not be read; the caller must then say nothing rather than guess.
   */
  periodEndIso: string | null;
  trialEndsAtIso: string | null;
};

export type RenewalNotice = {
  kind: "trial" | "cancels" | "renews" | "none";
  tone: StatusTone;
  /**
   * The sentence, with a `{date}` placeholder where the caller substitutes
   * its own formatted date — this module deliberately does not format
   * dates (lib/format.ts owns that, and it is not pure enough to import
   * into a test-only module without dragging Intl locale behaviour in).
   */
  template: string;
  /** The ISO instant `{date}` refers to, or null when the template has none. */
  dateIso: string | null;
  days: number | null;
};

/**
 * What happens next to this subscription, as one honest sentence — or the
 * "none" kind when the facts do not support any sentence at all.
 *
 * THE ORDER MATTERS AND IS DELIBERATE:
 *   1. A pending cancellation outranks everything. It is the fact a pilot
 *      most needs to see and the one Stripe's own dashboard buries.
 *   2. A live trial next: the charge that has not happened yet.
 *   3. A plain renewal last, and only when a period end was actually read.
 *
 * A non-writable status produces "none": the status banner already
 * explains that state in full (statusDisplay above), and a "renews on…"
 * line under a canceled account would contradict it.
 */
export function renewalNotice(facts: RenewalFacts, now: Date): RenewalNotice {
  const none: RenewalNotice = {
    kind: "none",
    tone: "gray",
    template: "",
    dateIso: null,
    days: null,
  };

  if (facts.cancelAtPeriodEnd) {
    // Honest even when the period end could not be read: the cancellation
    // is a fact from the same Stripe call, so it is said either way.
    return facts.periodEndIso
      ? {
          kind: "cancels",
          tone: "amber",
          template:
            "Set to cancel on {date}. Until then nothing changes; after that this account goes read-only and every record stays viewable and exportable.",
          dateIso: facts.periodEndIso,
          days: daysUntil(facts.periodEndIso, now),
        }
      : {
          kind: "cancels",
          tone: "amber",
          template:
            "Set to cancel at the end of the current billing period. Until then nothing changes; after that this account goes read-only and every record stays viewable and exportable.",
          dateIso: null,
          days: null,
        };
  }

  if (!statusIsWritable(facts.status)) return none;

  const trialDays = trialDaysRemaining(facts.status, facts.trialEndsAtIso, now);
  if (trialDays !== null) {
    return {
      kind: "trial",
      tone: trialDays <= 2 ? "amber" : "blue",
      template:
        trialDays === 0
          ? "Your trial ends today ({date}) and your card is charged then."
          : trialDays === 1
            ? "1 day left in your trial. Your card is charged on {date}."
            : `${trialDays} days left in your trial. Your card is charged on {date}.`,
      dateIso: facts.trialEndsAtIso ?? null,
      days: trialDays,
    };
  }

  if (facts.periodEndIso) {
    return {
      kind: "renews",
      tone: "gray",
      template: "Renews automatically on {date}.",
      dateIso: facts.periodEndIso,
      days: daysUntil(facts.periodEndIso, now),
    };
  }

  return none;
}

/** Substitutes a caller-formatted date into a RenewalNotice template. */
export function renewalText(notice: RenewalNotice, formattedDate: string): string {
  return notice.template.replace("{date}", formattedDate);
}
