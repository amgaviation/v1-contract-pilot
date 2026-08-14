/**
 * Pure helpers for the estimates screens. No imports, deliberately: this
 * file is exercised by tests/estimate-lib.test.mjs under plain `node
 * --test`, and it is shared by server actions and client components alike,
 * so nothing here may touch the database, the environment, or server-only
 * modules.
 *
 * Everything in this file mirrors a rule that already lives in
 * supabase/migrations/20260810060000_phase10_estimates.sql (plus the
 * 20260812 require-lines-on-send follow-up). The database is the
 * enforcement; these copies exist so the UI never offers a control
 * the triggers would refuse, and so the refusals that do reach the UI can
 * be turned into sentences. If the migration's rules change, change these
 * to match — never the other way around.
 */

export type EstimateStatus = "draft" | "sent" | "accepted" | "declined";

export const ESTIMATE_STATUSES: readonly EstimateStatus[] = [
  "draft",
  "sent",
  "accepted",
  "declined",
] as const;

/**
 * pilot.estimates_protect's transition table, verbatim:
 *
 *   (old.status = 'draft'    and new.status = 'sent') or
 *   (old.status = 'sent'     and new.status in ('accepted', 'declined', 'draft')) or
 *   (old.status = 'declined' and new.status in ('sent', 'accepted'))
 *
 * `accepted` is terminal here on purpose — an accepted quote may already
 * have produced an invoice, and the migration's own comment explains why
 * accepted -> declined is not offered. Conversion to an invoice is NOT a
 * status transition (status stays 'accepted'); it is the
 * estimate_convert_to_invoice function.
 */
export const ESTIMATE_TRANSITIONS: Record<EstimateStatus, readonly EstimateStatus[]> = {
  draft: ["sent"],
  sent: ["accepted", "declined", "draft"],
  declined: ["sent", "accepted"],
  accepted: [],
};

export function canTransition(from: EstimateStatus, to: EstimateStatus): boolean {
  return (ESTIMATE_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * The status vocabulary as a pilot reads it. "Sent" rather than "Issued":
 * the transition's own trigger is named assign_number_on_issue, but the
 * thing the pilot did is send a quote to a client, and that's the word the
 * whole lifecycle (send, accept, decline, revise and re-send) hangs off.
 */
export type EstimateBadge = {
  color: "gray" | "blue" | "green" | "red" | "amber";
  label: string;
};

export const ESTIMATE_STATUS_FALLBACK: EstimateBadge = { color: "gray", label: "Draft" };

export const ESTIMATE_STATUS_BADGE: Record<EstimateStatus, EstimateBadge> = {
  draft: ESTIMATE_STATUS_FALLBACK,
  sent: { color: "blue", label: "Sent" },
  accepted: { color: "green", label: "Accepted" },
  declined: { color: "red", label: "Declined" },
};

/**
 * Same vocabulary as pilot.invoice_lines.line_type — the migration is
 * explicit that the two lists must stay in step or conversion starts
 * silently dropping line types. Unlike the invoice screens'
 * MANUAL_LINE_TYPES, reimbursable_expense IS offered here: estimate_lines
 * has no expense_id column to tie it to (a quote prices an expected
 * reimbursable, it doesn't attach a receipt that doesn't exist yet).
 */
export const ESTIMATE_LINE_TYPES = [
  "flight_day",
  "travel_day",
  "per_diem",
  "reimbursable_expense",
  "cancellation_fee",
  "other",
] as const;

export type EstimateLineType = (typeof ESTIMATE_LINE_TYPES)[number];

export const ESTIMATE_LINE_TYPE_LABEL: Record<EstimateLineType, string> = {
  flight_day: "Flight day",
  travel_day: "Travel day",
  per_diem: "Per diem",
  reimbursable_expense: "Reimbursable expense",
  cancellation_fee: "Cancellation fee",
  other: "Other",
};

/**
 * A tax percent input ("8.25") to the basis-points integer
 * pilot.estimates.tax_rate_bps stores ("825"). Duplicated from
 * invoices/actions.ts's local helper rather than imported from it — that
 * file is another agent's surface this session, and the arithmetic is
 * three lines. The 2500 ceiling is the column's own CHECK.
 */
export function parsePercentToBps(raw: string): number | null | undefined {
  const value = raw.trim();
  if (value === "") return null;
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(value)) return undefined;
  const bps = Math.round(Number(value) * 100);
  if (!Number.isFinite(bps) || bps < 0 || bps > 2500) return undefined;
  return bps;
}

/**
 * A quantity destined for estimate_lines.quantity, numeric(6,2). Checked
 * here for the same reason invoices/actions.ts checks its numeric(6,2)
 * quantities: Postgres silently ROUNDS an out-of-scale value rather than
 * rejecting it, and a server action is a public POST endpoint that cannot
 * rely on the browser's <input step> having been honored.
 */
export function parseQuantity(raw: string): number | undefined {
  const value = raw.trim();
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(value)) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 9999) return undefined;
  return parsed;
}

/** "YYYY-MM-DD", and a date that actually exists. */
export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/**
 * The new-estimate form's running preview, computed the way
 * pilot.estimate_totals computes the real thing so the number the pilot
 * sees while typing is the number the draft will show:
 *
 *   - each line's amount is round(quantity * unit_amount_cents) — the
 *     GENERATED amount_cents column's own expression;
 *   - tax applies to the TAXABLE subtotal only, per line, never to the
 *     whole document;
 *   - tax_cents is round(taxable_subtotal * bps / 10000).
 *
 * A preview only — the view stays the single source once the row exists.
 */
export function previewTotals(
  lines: readonly { quantity: number; unitAmountCents: number; taxable: boolean }[],
  taxRateBps: number
): { subtotalCents: number; taxCents: number; totalCents: number } {
  let subtotalCents = 0;
  let taxableSubtotalCents = 0;
  for (const line of lines) {
    const amount = Math.round(line.quantity * line.unitAmountCents);
    subtotalCents += amount;
    if (line.taxable) taxableSubtotalCents += amount;
  }
  const taxCents = Math.round((taxableSubtotalCents * taxRateBps) / 10000);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

/**
 * The refusals pilot.estimate_convert_to_invoice and the estimate triggers
 * raise as plain P0001s, turned into sentences. friendlyDbError scrubs
 * every unrecognized code down to "Couldn't save that. Try again." — safe,
 * and useless for these, because the function's own messages name exactly
 * what is wrong. They also carry raw uuids for an unnumbered estimate, so
 * they are matched and re-worded here rather than passed through (same
 * posture as invoices/actions.ts's linesDbError).
 *
 * Returns null for a message this map doesn't know, so the caller falls
 * back to friendlyDbError instead of inventing a sentence.
 */
export function estimateRefusalMessage(
  error: { code?: string | null; message?: string | null } | null | undefined
): string | null {
  if (!error || error.code !== "P0001") return null;
  const message = (error.message ?? "").toLowerCase();
  if (message.includes("already been converted")) {
    return "This estimate has already become an invoice, so it can't be changed. Open the invoice to make changes there.";
  }
  if (message.includes("only an accepted estimate")) {
    return "Only an accepted estimate can become an invoice. Reload the page to see where this one stands.";
  }
  if (message.includes("no lines to invoice")) {
    return "This estimate has no line items, so there's nothing to put on an invoice. Add at least one line first.";
  }
  // pilot.estimates_require_lines_on_send (the 20260812 migration): the
  // database refuses draft -> sent on an estimate with zero lines, closing
  // the race where a second tab deletes the last line while this one sends.
  if (message.includes("cannot be sent with no line items")) {
    return "This estimate has no line items, so it can't be sent. Add at least one line first.";
  }
  if (message.includes("not found")) {
    return "That estimate no longer exists.";
  }
  if (message.includes("cannot move from")) {
    return "This estimate's status has changed since this page loaded. Reload to see where it stands.";
  }
  if (message.includes("its number cannot change")) {
    return "This estimate has been sent. Its number is permanent.";
  }
  return null;
}
