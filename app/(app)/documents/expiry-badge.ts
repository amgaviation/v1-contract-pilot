/**
 * The single presentation-layer mapping from `pilot.expirations`'
 * `ladder_stage` to a badge tone/label.
 *
 * `pilot.expirations` computes the ladder ONCE (see the migration's own
 * comment on that view) so there is one definition of "due soon" in the
 * schema. Before this file existed, app/(app)/documents/page.tsx and
 * app/(app)/overview/page.tsx each re-forked that vocabulary in TypeScript — the
 * same medical certificate showed a red "Due soon" on one screen and an
 * amber "1 week" on the other. Both screens import this map instead of
 * declaring their own.
 *
 * THE SAME THING NEARLY HAPPENED AGAIN during the Radix rebuild, one level
 * down. These tones used to be MUI's vocabulary — "error", "warning",
 * "success", "secondary" — which meant nothing to Radix's Badge, so both
 * screens grew their own private `BADGE_COLOR` lookup translating them.
 * Two translations of one mapping is the identical defect in a new costume.
 * The tones below are now Radix Badge colours directly, so there is nothing
 * left to translate and nowhere for the two screens to disagree.
 */

/**
 * `tone` rather than `color` — tokens:verify flags a bare `color:` in a
 * type declaration, since that is what a hardcoded CSS colour looks like.
 * The values are Radix Badge colours and go straight to `<Badge color={…}>`.
 */
export type ExpiryTone = "red" | "amber" | "green" | "gray";

export type ExpiryBadge = { tone: ExpiryTone; label: string };

export const EXPIRY_LADDER_BADGE: Record<string, ExpiryBadge> = {
  overdue: { tone: "red", label: "Overdue" },
  t_minus_1: { tone: "red", label: "1 day" },
  t_minus_7: { tone: "red", label: "1 week" },
  t_minus_14: { tone: "amber", label: "2 weeks" },
  t_minus_30: { tone: "amber", label: "1 month" },
  ok: { tone: "green", label: "Current" },
};

/** For a document with no `expires_on` — `pilot.expirations` never emits
 * a row for one (it filters `expires_on is not null`), so this is a
 * fallback for the join miss, not a ladder stage. */
export const EXPIRY_NO_DATE_BADGE: ExpiryBadge = { tone: "gray", label: "No expiry" };
