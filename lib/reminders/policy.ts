import { formatCents, formatDate } from "@/lib/format";

/**
 * WHEN A REMINDER IS DUE, AND WHETHER IT MAY GO OUT.
 *
 * Pure functions over plain values — no database, no mail service, no
 * session, no `Date.now()`. Every function that needs "today" takes it as a
 * `YYYY-MM-DD` string, because that is the one thing a scheduled job must
 * never be allowed to disagree with itself about: the run that decides
 * whether a rung is ripe and the run that records the outcome have to be
 * looking at the same calendar day, and a job that reads the clock twice
 * across a midnight boundary is a job that skips or repeats a rung once a
 * year. tests/reminder-schedule.test.mjs pins the whole of it.
 *
 * WHY EVERY DATE HERE IS A PLAIN CALENDAR STRING AND THE ARITHMETIC IS UTC.
 * `invoices.due_on` is a Postgres `date`: a calendar fact with no time and no
 * zone, exactly like every other date column in this schema (see
 * lib/format.ts's parseCalendarDate for the same argument applied to
 * display). Parsing "2026-03-08" as local time in a negative-offset zone
 * yields the 7th, which would report an invoice a day more overdue than it
 * is — and on a DST-transition day, local-time arithmetic on a 24-hour
 * millisecond count lands on the wrong date outright: 2026-03-08 + 1 day is
 * 23 hours in New York, 2026-11-01 + 1 day is 25. Both are pinned in the
 * tests. Adding days by UTC calendar components is immune to all of it, and
 * `lib/email/invoice-message.ts`'s own daysOverdue already took this
 * position — this file holds the same line.
 */

/* ===========================================================================
 * THE RUNGS A PILOT MAY CHOOSE
 * ======================================================================== */

/**
 * OUR vocabulary, not the tenant's — the same line Phase 9's customisation
 * layer draws ("taxonomy is the tenant's, state machines are ours"). The
 * database CHECKs on pilot.clients.reminder_before_due/reminder_after_due
 * pin these same sets, so a value this file does not offer cannot be stored
 * even by a crafted request.
 *
 * Three before-due rungs and four after: 30 days early is not a thing anyone
 * does, and 30 days late is the most common chase point there is.
 */
export const REMINDER_BEFORE_DAYS = [3, 7, 14] as const;
export const REMINDER_AFTER_DAYS = [3, 7, 14, 30] as const;

export type ReminderPolicy = {
  /** Days BEFORE due_on a courtesy note goes out. */
  beforeDue: number[];
  /** A note on the due date itself. */
  onDue: boolean;
  /** Days AFTER due_on the chase ladder runs. */
  afterDue: number[];
};

/** No reminders at all — the default for every client, and every existing row. */
export const EMPTY_REMINDER_POLICY: ReminderPolicy = {
  beforeDue: [],
  onDue: false,
  afterDue: [],
};

/**
 * Untrusted values (a jsonb-shaped API response, a form post, an array
 * written by a build that offered a rung this one has retired) to a policy
 * this build understands. TOTAL: never throws, and anything it cannot vouch
 * for resolves to "no reminder", which is the state every account starts in
 * and the only safe direction to fail in — an unrecognised value must never
 * become an email somebody's client receives.
 *
 * De-duplicates and sorts. The database CHECK deliberately does not assert
 * uniqueness (a CHECK cannot hold a subquery), so this is where {7,7} stops
 * being two rungs — and even if it did not, both resolve to one rule_key and
 * the ledger's unique index refuses the second row. Two independent reasons
 * a duplicate cannot become a duplicate email.
 */
export function normalizeReminderPolicy(raw: {
  beforeDue?: unknown;
  onDue?: unknown;
  afterDue?: unknown;
}): ReminderPolicy {
  return {
    beforeDue: normalizeDays(raw.beforeDue, REMINDER_BEFORE_DAYS),
    onDue: raw.onDue === true,
    afterDue: normalizeDays(raw.afterDue, REMINDER_AFTER_DAYS),
  };
}

function normalizeDays(value: unknown, allowed: readonly number[]): number[] {
  if (!Array.isArray(value)) return [];
  const kept: number[] = [];
  for (const entry of value) {
    const day = typeof entry === "number" ? entry : Number(entry);
    if (!Number.isInteger(day)) continue;
    if (!allowed.includes(day)) continue;
    if (kept.includes(day)) continue;
    kept.push(day);
  }
  return kept.sort((a, b) => a - b);
}

/** Nothing configured — used to decide whether an invoice is in scope at all. */
export function reminderPolicyIsEmpty(policy: ReminderPolicy): boolean {
  return (
    policy.beforeDue.length === 0 &&
    !policy.onDue &&
    policy.afterDue.length === 0
  );
}

/* ===========================================================================
 * RUNGS
 * ======================================================================== */

export type RungKind = "before" | "on" | "after";

export type Rung = {
  /** The stored key — pilot.invoice_reminder_sends.rule_key. */
  key: string;
  kind: RungKind;
  /** Days either side of the due date. 0 for the due date itself. */
  offsetDays: number;
  /** The calendar day this rung becomes ripe, "YYYY-MM-DD". */
  onDate: string;
};

/**
 * The stored identity of a rung. This string is a key in a unique index, so
 * it is generated in exactly one place and never re-spelled at a call site —
 * a typo would not be a bug that shows up as a wrong string, it would be a
 * bug that shows up as a client receiving the same reminder twice.
 */
export function rungKey(kind: RungKind, offsetDays: number): string {
  if (kind === "on") return "on_due";
  return `${kind === "before" ? "before" : "after"}_${offsetDays}`;
}

/** The key the manual "send a reminder" button records under. Repeatable. */
export const MANUAL_RULE_KEY = "manual";

/**
 * Every rung this policy defines for an invoice due on `dueOn`, in calendar
 * order. An invoice with no due date has no rungs at all — every one of them
 * is defined relative to a due date, and inventing one would invent a payment
 * term the pilot never agreed (the same refusal lib/email/invoice-message.ts's
 * applyTemplate makes when {{due_date}} has nothing to fill in).
 */
export function rungsFor(policy: ReminderPolicy, dueOn: string | null): Rung[] {
  if (!dueOn || !isCalendarDate(dueOn)) return [];
  const rungs: Rung[] = [];
  for (const days of policy.beforeDue) {
    rungs.push({
      key: rungKey("before", days),
      kind: "before",
      offsetDays: days,
      onDate: addDays(dueOn, -days),
    });
  }
  if (policy.onDue) {
    rungs.push({ key: "on_due", kind: "on", offsetDays: 0, onDate: dueOn });
  }
  for (const days of policy.afterDue) {
    rungs.push({
      key: rungKey("after", days),
      kind: "after",
      offsetDays: days,
      onDate: addDays(dueOn, days),
    });
  }
  return rungs.sort((a, b) => (a.onDate < b.onDate ? -1 : a.onDate > b.onDate ? 1 : 0));
}

/** How a rung is described to the pilot — never to a client. */
export function describeRung(rung: Rung): string {
  if (rung.kind === "on") return "On the due date";
  if (rung.kind === "before") {
    return `${rung.offsetDays} day${rung.offsetDays === 1 ? "" : "s"} before due`;
  }
  return `${rung.offsetDays} day${rung.offsetDays === 1 ? "" : "s"} past due`;
}

/**
 * A whole schedule in one line, for a list of clients. "Nothing" is said
 * plainly rather than as an empty string — a blank cell next to a client's
 * name reads as a rendering fault, and the whole point of the settings list
 * is that a pilot can see at a glance which of their clients this product
 * will write to.
 */
export function describeSchedule(policy: ReminderPolicy): string {
  if (reminderPolicyIsEmpty(policy)) return "No reminders";
  const parts: string[] = [];
  if (policy.beforeDue.length > 0) {
    parts.push(`${policy.beforeDue.join(" and ")} days before due`);
  }
  if (policy.onDue) parts.push("on the due date");
  if (policy.afterDue.length > 0) {
    parts.push(`${policy.afterDue.join(", ")} days past due`);
  }
  return parts.join("; ");
}

/* ===========================================================================
 * THE DECISION
 * ======================================================================== */

/**
 * How long after ANY reminder (manual or scheduled) the ladder holds off.
 *
 * Five days, and the number is doing real work: the manual "Send a reminder"
 * button exists and pilots use it, so without this the product chases a
 * client on Tuesday because the pilot pressed a button and again on Thursday
 * because a rung came due — two chases in one week, from one business, about
 * one invoice, and the pilot only knows about one of them. Short enough that
 * a 3/7/14-day ladder still steps, long enough that a human chase is never
 * immediately followed by a machine one.
 *
 * A hold is NOT a consumption: the rung stays available and simply comes up
 * again once the quiet period lapses.
 */
export const QUIET_PERIOD_DAYS = 5;

/**
 * How recently the share link must have been fetched for the ladder to hold.
 *
 * Two days. "The link was opened yesterday" is the one piece of evidence this
 * product has that the invoice is in front of somebody, and chasing into that
 * is how a reminder reads as an accusation. It is deliberately SHORT, because
 * the evidence is weak: pilot.invoice_shares' own migration is explicit that a
 * stamp means "the link was FETCHED while valid" — mail scanners count — so it
 * can justify waiting a day or two and could never justify calling an invoice
 * "seen".
 */
export const RECENTLY_VIEWED_DAYS = 2;

export type ReminderHoldReason =
  | "suppressed"
  | "no_due_date"
  | "no_policy"
  | "recent_reminder"
  | "recent_send"
  | "recently_viewed"
  | "nothing_due";

export type ReminderDecision =
  | {
      /** Send this rung now, and consume these others as skipped. */
      action: "send";
      rung: Rung;
      supersede: { rung: Rung; reason: "superseded" | "stale" }[];
    }
  | {
      /** Nothing to send, but these rungs' moments have passed for good. */
      action: "consume";
      supersede: { rung: Rung; reason: "superseded" | "stale" }[];
    }
  | { action: "hold"; reason: ReminderHoldReason };

export type ReminderInput = {
  policy: ReminderPolicy;
  dueOn: string | null;
  /** "YYYY-MM-DD" — supplied by the caller, never read from the clock here. */
  today: string;
  /** rule_keys already recorded for this invoice (sent, failed or skipped). */
  consumed: readonly string[];
  /**
   * When a reminder last actually WENT OUT for this invoice, ISO instant or
   * null.
   *
   * Only successful sends belong here. A skipped rung reached nobody, and a
   * failed one reached nobody either — treating either as "recently chased"
   * would start a five-day quiet period on the strength of a message that was
   * never delivered, which is the scheduler talking itself out of its own job.
   */
  lastReminderAt: string | null;
  /**
   * invoices.sent_at — when the invoice ITSELF went out, ISO instant or null.
   *
   * The original invoice email is not a row in invoice_reminder_sends (it
   * isn't a reminder), so without this a client whose payment terms are no
   * longer than their largest before-due rung — net-7 with the 7-day rung,
   * net-14 with 14 — has that rung already ripe on the day the invoice is
   * sent: a courtesy note about a bill due in N days would land hours after
   * the bill itself. Folded into the same quiet period as lastReminderAt,
   * for the same reason QUIET_PERIOD_DAYS exists at all — one business,
   * two messages, in one day, about one invoice.
   */
  sentAt: string | null;
  /** invoice_shares.last_viewed_at, ISO instant or null. */
  lastViewedAt: string | null;
  /** invoices.reminders_suppressed. */
  suppressed: boolean;
};

/**
 * ONE DECISION, AND AT MOST ONE EMAIL.
 *
 * The rule that shapes everything below: a run sends AT MOST ONE reminder per
 * invoice, and it is the MOST ADVANCED rung that has come due. Every earlier
 * rung that is also ripe is consumed as 'superseded' rather than sent.
 *
 * That matters most in the case a pilot will actually hit: switching reminders
 * on for a client whose invoice is already 40 days past due. The naive
 * implementation finds after_3, after_7, after_14 and after_30 all ripe and
 * sends four emails in one minute, to a real client, about one bill. This
 * sends one — the 30-day wording, which is the true one — and records the
 * other three as skipped so they can never fire later either.
 *
 * The second rule: a BEFORE-due or ON-due rung whose moment has passed is
 * never sent. "This is due in three days" arriving three weeks late is worse
 * than silence, because it is wrong. Those consume as 'stale'.
 *
 * A HOLD CONSUMES NOTHING. If the invoice is suppressed, or a chase went out
 * four days ago, or the client opened the link yesterday, the run does
 * nothing at all — it does not quietly eat the ladder while it waits. The same
 * rungs come up again tomorrow.
 */
export function decideReminder(input: ReminderInput): ReminderDecision {
  if (input.suppressed) return { action: "hold", reason: "suppressed" };
  if (!input.dueOn || !isCalendarDate(input.dueOn)) {
    return { action: "hold", reason: "no_due_date" };
  }
  if (reminderPolicyIsEmpty(input.policy)) {
    return { action: "hold", reason: "no_policy" };
  }

  const consumed = new Set(input.consumed);
  const ripe = rungsFor(input.policy, input.dueOn).filter(
    (rung) => !consumed.has(rung.key) && rung.onDate <= input.today
  );
  if (ripe.length === 0) return { action: "hold", reason: "nothing_due" };

  // STALE: a before-due or on-due rung on an invoice that is now PAST DUE.
  //
  // The test is the due date, not the rung's own day, and the difference
  // matters when a run is missed. The built-in wording states the due date as
  // a fact ("is due Sep 10") rather than as a countdown, so a courtesy note
  // sent a day or two late is still true and still worth sending — losing it
  // because a cron delivery failed would be the scheduler punishing the
  // pilot for its own outage. What is NOT true is a courtesy note about an
  // invoice that has already gone overdue: the wording flips to the overdue
  // form and the past-due ladder is what covers that ground. So the window
  // for these rungs is "from its day until the invoice is late", and no
  // longer.
  const overdue = input.today > input.dueOn;
  const stale = ripe.filter((rung) => rung.kind !== "after" && overdue);
  const sendable = ripe.filter((rung) => !stale.includes(rung));

  // The quiet periods are checked AFTER ripeness so that a hold reports the
  // reason a pilot needs ("a reminder went out on the 4th"), and BEFORE any
  // consumption so a hold never costs a rung.
  const sinceReminder = input.lastReminderAt
    ? daysSinceInstant(input.lastReminderAt, input.today)
    : null;
  if (sinceReminder !== null && sinceReminder < QUIET_PERIOD_DAYS) {
    return { action: "hold", reason: "recent_reminder" };
  }
  // The invoice's own send starts the same quiet period a reminder would —
  // see ReminderInput.sentAt. Checked separately from sinceReminder (rather
  // than folded into lastReminderAt upstream) because the two are different
  // facts with different callers: this one is always present the moment an
  // invoice is sent, well before any reminder has a chance to be.
  const sinceSent = input.sentAt ? daysSinceInstant(input.sentAt, input.today) : null;
  if (sinceSent !== null && sinceSent < QUIET_PERIOD_DAYS) {
    return { action: "hold", reason: "recent_send" };
  }
  const sinceViewed = input.lastViewedAt
    ? daysSinceInstant(input.lastViewedAt, input.today)
    : null;
  if (sinceViewed !== null && sinceViewed < RECENTLY_VIEWED_DAYS) {
    return { action: "hold", reason: "recently_viewed" };
  }

  const staleEntries = stale.map(
    (rung) => ({ rung, reason: "stale" as const })
  );

  if (sendable.length === 0) {
    return { action: "consume", supersede: staleEntries };
  }

  // rungsFor sorts by date; the last sendable one is the most advanced.
  const chosen = sendable[sendable.length - 1]!;
  const superseded = sendable
    .filter((rung) => rung.key !== chosen.key)
    .map((rung) => ({ rung, reason: "superseded" as const }));

  return { action: "send", rung: chosen, supersede: [...staleEntries, ...superseded] };
}

/**
 * The pilot-facing sentence for a hold. Written for the invoice screen, so it
 * explains rather than merely labels — a pilot looking at an invoice that is
 * eleven days overdue with reminders switched on needs to know WHY nothing has
 * gone out, and "recently_viewed" on its own tells them nothing.
 */
export function describeHold(reason: ReminderHoldReason): string {
  switch (reason) {
    case "suppressed":
      return "Reminders are switched off for this invoice.";
    case "no_due_date":
      return "This invoice has no due date, so there is nothing to schedule reminders against.";
    case "no_policy":
      return "This client has no reminder schedule set.";
    case "recent_reminder":
      return `A reminder went out in the last ${QUIET_PERIOD_DAYS} days, so the next one waits.`;
    case "recent_send":
      return `The invoice itself went out in the last ${QUIET_PERIOD_DAYS} days, so the first reminder waits.`;
    case "recently_viewed":
      return "The client opened the invoice link in the last couple of days, so the next reminder waits.";
    case "nothing_due":
      return "Nothing is due to go out yet.";
  }
}

/* ===========================================================================
 * LATE FEES — a contract term the pilot chose, never a computed entitlement
 * ======================================================================== */

export type LateFeePolicy = {
  flatCents: number | null;
  bpsPerMonth: number | null;
  graceDays: number;
  noteOnReminders: boolean;
};

export const NO_LATE_FEE: LateFeePolicy = {
  flatCents: null,
  bpsPerMonth: null,
  graceDays: 0,
  noteOnReminders: false,
};

/**
 * Total over untrusted values, and it fails to NO FEE. Every rejection path
 * here — a negative amount, a rate above the ceiling, both kinds set at once —
 * resolves to "nothing agreed", because the alternative is a product that
 * bills somebody's client on the strength of a value it could not vouch for.
 */
export function normalizeLateFeePolicy(raw: {
  flatCents?: unknown;
  bpsPerMonth?: unknown;
  graceDays?: unknown;
  noteOnReminders?: unknown;
}): LateFeePolicy {
  // AN AMOUNT MUST BE ABOVE ZERO, not merely non-negative. A zero flat fee
  // satisfies hasLateFee() and walks straight into a "$0.00 late fee" in a
  // client's inbox, a $0.00 quote on screen, and an amount_cents = 0 insert
  // that dies on the ledger's own CHECK. The database CHECK already refuses
  // zero, so nothing stored can reach here that way — but this function's
  // contract is to be total over UNTRUSTED values, and an import or an API
  // payload is exactly the caller that contract is for.
  const flat = amountInt(raw.flatCents);
  const bps = amountInt(raw.bpsPerMonth);
  // Both set is unrepresentable in the database (CHECK) — if it is ever seen
  // here anyway, neither is used. Picking one would be picking on the pilot's
  // behalf about money their client owes.
  const bothSet = flat !== null && bps !== null;
  // Grace is the one value where zero is a real answer: "from the due date".
  const grace = nonNegativeInt(raw.graceDays) ?? 0;
  const policy: LateFeePolicy = {
    flatCents: bothSet ? null : flat,
    bpsPerMonth: bothSet || bps === null || bps > 500 ? null : bps,
    graceDays: grace > 90 ? 0 : grace,
    noteOnReminders: raw.noteOnReminders === true,
  };
  if (policy.flatCents === null && policy.bpsPerMonth === null) {
    return { ...NO_LATE_FEE, graceDays: policy.graceDays };
  }
  return policy;
}

/** A whole number of cents or basis points, and it has to be worth billing. */
function amountInt(value: unknown): number | null {
  const n = nonNegativeInt(value);
  return n === null || n === 0 ? null : n;
}

/** Zero allowed — only grace days, where zero means "from the due date". */
function nonNegativeInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

export function hasLateFee(policy: LateFeePolicy): boolean {
  return policy.flatCents !== null || policy.bpsPerMonth !== null;
}

/** The first day an agreed fee could apply: due date plus the grace period. */
export function lateFeeStartDate(dueOn: string, policy: LateFeePolicy): string {
  return addDays(dueOn, policy.graceDays);
}

export type LateFeeQuote = {
  amountCents: number;
  basis: "flat" | "bps_per_month";
  /** Only for a rate fee. */
  basisBps: number | null;
  monthsAccrued: number | null;
  /** The month this fee would be recorded against — the idempotency key. */
  periodStart: string;
  /** The plain-English arithmetic, for the pilot to check before agreeing. */
  explanation: string;
};

/**
 * What the pilot's OWN agreed fee comes to today, or null if there is nothing
 * to bill.
 *
 * MONTHS ARE CALENDAR MONTHS, not 30-day blocks — the same rule
 * 20260809030000 set for recurring periods ("period arithmetic is calendar
 * arithmetic, no day counts, ever") and for the same reason: a 30-day count
 * drifts against the month it claims to be, so a "1.5% per month" fee quietly
 * becomes 1.52%/month over a year. Month-end clamps the way that migration
 * clamps: a fee starting Jan 31 accrues its next month on Feb 28.
 *
 * ALREADY-BILLED MONTHS ARE SUBTRACTED, not recomputed. Without that, a second
 * fee raised in month four would bill four months again on top of the three
 * already invoiced. The caller supplies the sum of months_accrued from
 * pilot.invoice_late_fees, and the unique (source_invoice, period_start)
 * constraint is the backstop underneath it.
 *
 * A FLAT FEE IS ONCE, EVER — and that holds in BOTH directions. A prior fee of
 * any kind blocks a further flat one, and a prior FLAT fee blocks a rate one
 * too: a flat fee is a single charge for the lateness itself, so once it has
 * been raised there is no month left to charge for. Without that second half,
 * a pilot who raised a $50 flat fee and later renegotiated the same client to
 * 1.5%/month would be offered a rate fee covering every month since the due
 * date — including the lateness the flat fee already billed — because
 * months_accrued is null on a flat row and subtracts nothing. That is a client
 * billed twice for one overdue period, and a draft-review step is not a reason
 * to compute it wrong. A pilot who genuinely wants to charge on beyond a flat
 * fee can raise an invoice by hand, which is a decision with a person behind
 * it rather than a number this product volunteered.
 */
export function quoteLateFee(input: {
  policy: LateFeePolicy;
  balanceDueCents: number;
  dueOn: string | null;
  today: string;
  /** Sum of months_accrued across fees already raised for this invoice. */
  monthsAlreadyBilled: number;
  /** Whether any fee at all has been raised for this invoice. */
  anyFeeAlreadyRaised: boolean;
  /**
   * Whether one of those prior fees was a FLAT one. Defaults to false so a
   * caller that has not looked is never told a flat fee is in the way — but
   * every caller in this codebase reads `basis` from pilot.invoice_late_fees
   * on the same query it already runs for months_accrued.
   */
  flatFeeAlreadyRaised?: boolean;
}): LateFeeQuote | null {
  const { policy, dueOn, today } = input;
  if (!hasLateFee(policy)) return null;
  if (!dueOn || !isCalendarDate(dueOn) || !isCalendarDate(today)) return null;
  if (input.balanceDueCents <= 0) return null;

  const start = lateFeeStartDate(dueOn, policy);
  if (today <= start) return null;

  const periodStart = `${today.slice(0, 7)}-01`;

  if (policy.flatCents !== null) {
    if (input.anyFeeAlreadyRaised) return null;
    return {
      amountCents: policy.flatCents,
      basis: "flat",
      basisBps: null,
      monthsAccrued: null,
      periodStart,
      explanation: `A flat ${formatCents(policy.flatCents)}, once, because the balance is still outstanding after ${
        policy.graceDays === 0 ? "the due date" : `${policy.graceDays} days past the due date`
      }.`,
    };
  }

  // A flat fee already charged for this invoice being late, and nothing here
  // can tell how much of the lateness it was meant to cover — see the header.
  if (input.flatFeeAlreadyRaised) return null;

  const bps = policy.bpsPerMonth as number;
  const total = completeMonthsBetween(start, today);
  const months = total - Math.max(0, Math.trunc(input.monthsAlreadyBilled));
  if (months <= 0) return null;

  // Rounded ONCE, on the whole thing, rather than per month and summed —
  // per-month rounding drifts by up to a cent a month against the figure the
  // agreement describes.
  const amountCents = Math.round((input.balanceDueCents * bps * months) / 10_000);
  if (amountCents <= 0) return null;

  return {
    amountCents,
    basis: "bps_per_month",
    basisBps: bps,
    monthsAccrued: months,
    periodStart,
    explanation: `${formatBps(bps)} per month of the ${formatCents(
      input.balanceDueCents
    )} still outstanding, for ${months} complete month${
      months === 1 ? "" : "s"
    } since ${formatDate(start)}.`,
  };
}

/** The description written onto the fee invoice's own line. */
export function lateFeeLineDescription(
  quote: LateFeeQuote,
  sourceInvoiceNumber: string | null,
  sourceDueOn: string | null
): string {
  const reference = sourceInvoiceNumber
    ? `Invoice ${sourceInvoiceNumber}`
    : "an earlier invoice";
  const due = sourceDueOn ? `, due ${formatDate(sourceDueOn)}` : "";
  return quote.basis === "flat"
    ? `Late fee as agreed: ${reference}${due}`
    : `Late fee as agreed, ${formatBps(quote.basisBps ?? 0)} per month for ${
        quote.monthsAccrued
      } month${quote.monthsAccrued === 1 ? "" : "s"}: ${reference}${due}`;
}

/**
 * THE PILOT'S OWN WORDS BACK TO THEM. "Your late fee", because it is theirs —
 * a term they negotiated and typed in, not something this product worked out
 * they are entitled to. Nothing in this product ever tells a pilot they may
 * charge a late fee, and nothing tells a client they must pay one.
 */
export function describeLateFeePolicy(policy: LateFeePolicy): string | null {
  if (!hasLateFee(policy)) return null;
  const amount =
    policy.flatCents !== null
      ? `a flat ${formatCents(policy.flatCents)}`
      : `${formatBps(policy.bpsPerMonth ?? 0)} per month`;
  const grace =
    policy.graceDays === 0
      ? "once an invoice is past due"
      : `once an invoice is ${policy.graceDays} days past due`;
  return `Your late fee for this client: ${amount}, ${grace}.`;
}

/**
 * The one late-fee sentence a CLIENT may ever read, and only when the pilot
 * has separately switched it on (clients.late_fee_note_on_reminders).
 *
 * It states the AGREEMENT and nothing else: no computed amount, no running
 * total, no "now owing". A figure in this position would read as part of the
 * balance due, and the balance due comes from pilot.invoice_totals or it does
 * not exist. It also never threatens: "per our agreement" is a reminder of
 * what was signed, which is the only standing this product has.
 */
export function lateFeeReminderSentence(policy: LateFeePolicy): string | null {
  if (!policy.noteOnReminders || !hasLateFee(policy)) return null;
  const amount =
    policy.flatCents !== null
      ? `a late fee of ${formatCents(policy.flatCents)}`
      : `a late fee of ${formatBps(policy.bpsPerMonth ?? 0)} per month`;
  const when =
    policy.graceDays === 0
      ? "on balances past their due date"
      : `on balances more than ${policy.graceDays} days past their due date`;
  return `Per our agreement, ${amount} applies ${when}.`;
}

/** 150 -> "1.5%", 200 -> "2%". Never a float in the arithmetic, only here. */
export function formatBps(bps: number): string {
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0$/, "")}%`;
}

/* ===========================================================================
 * CALENDAR ARITHMETIC — UTC, and nothing else
 * ======================================================================== */

/** "YYYY-MM-DD", and a date that actually exists (2026-02-30 is not one). */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/** The calendar day an instant falls on, in UTC. */
export function toCalendarDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * n days later (or earlier) on the calendar. Built from UTC components rather
 * than by adding 86,400,000 milliseconds n times, because a local-time day is
 * 23 or 25 hours twice a year and the millisecond version lands on the wrong
 * date when it crosses one. Date.UTC normalises overflow, so month and year
 * ends need no special case.
 */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const shifted = new Date(Date.UTC(y!, m! - 1, d! + days));
  return shifted.toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to`; negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Whole days between an INSTANT (a timestamptz column) and a calendar day.
 * Returns null for anything unparseable, which every caller treats as "no
 * information" rather than as zero — a malformed timestamp must not read as
 * "this happened today" and hold the ladder forever.
 */
export function daysSinceInstant(instant: string, today: string): number | null {
  const then = Date.parse(instant);
  if (Number.isNaN(then)) return null;
  return daysBetween(new Date(then).toISOString().slice(0, 10), today);
}

/**
 * COMPLETE CALENDAR MONTHS from `start` to `today`.
 *
 * Counted by adding calendar months to the start date, not by dividing a day
 * count by 30. Month-end clamps: a start of the 31st has its monthly
 * anniversary on the 28th/29th/30th in months that are short, never rolling
 * into the 1st of the next month (which would make every later anniversary
 * creep forward) and never skipping the month (which would silently drop an
 * accrual). Identical resolution, for identical reasons, to the periodDueDate
 * clamp documented in 20260809030000's header.
 */
export function completeMonthsBetween(start: string, today: string): number {
  if (!isCalendarDate(start) || !isCalendarDate(today)) return 0;
  if (today <= start) return 0;
  let months = 0;
  // Bounded rather than while(true): a decade of accrual is already far past
  // anything a real receivable reaches, and an unbounded loop over untrusted
  // dates is a hang waiting for a bad row.
  while (months < 120 && addMonthsClamped(start, months + 1) <= today) {
    months += 1;
  }
  return months;
}

/**
 * `start` plus n calendar months, clamped to the last day of the target month
 * when the day-of-month does not exist there.
 */
export function addMonthsClamped(start: string, months: number): string {
  const [y, m, d] = start.slice(0, 10).split("-").map(Number);
  const targetMonthIndex = m! - 1 + months;
  const targetYear = y! + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  // Day 0 of the FOLLOWING month is the last day of this one.
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(d!, lastDay);
  return new Date(Date.UTC(targetYear, targetMonth, day)).toISOString().slice(0, 10);
}
