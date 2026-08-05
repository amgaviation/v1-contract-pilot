/**
 * The single presentation-layer mapping from `pilot.expirations`'
 * `ladder_stage` to a badge tone/label.
 *
 * `pilot.expirations` computes the ladder ONCE (see the migration's own
 * comment on that view) so there is one definition of "due soon" in the
 * schema. Before this file existed, app/(app)/documents/page.tsx and
 * app/(app)/page.tsx each re-forked that vocabulary in TypeScript — the
 * same medical certificate showed a red "Due soon" on one screen and an
 * amber "1 week" on the other. Both screens import this map instead of
 * declaring their own.
 */

/** `tone` rather than `color` — tokens:verify flags a bare `color:`. */
export type ExpiryBadge = { tone: string; label: string };

export const EXPIRY_LADDER_BADGE: Record<string, ExpiryBadge> = {
  overdue: { tone: "error", label: "Overdue" },
  t_minus_1: { tone: "error", label: "1 day" },
  t_minus_7: { tone: "error", label: "1 week" },
  t_minus_14: { tone: "warning", label: "2 weeks" },
  t_minus_30: { tone: "warning", label: "1 month" },
  ok: { tone: "success", label: "Current" },
};

/** For a document with no `expires_on` — `pilot.expirations` never emits
 * a row for one (it filters `expires_on is not null`), so this is a
 * fallback for the join miss, not a ladder stage. */
export const EXPIRY_NO_DATE_BADGE: ExpiryBadge = { tone: "secondary", label: "No expiry" };
