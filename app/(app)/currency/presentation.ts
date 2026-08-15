/**
 * Pure presentation helpers for the currency board. No I/O, no JSX, no
 * `server-only` — importable by tests/currency-ui.test.mjs under plain
 * `node --test` (which does not pass `--conditions=react-server`; see
 * lib/currency/index.ts's header for the precedent).
 *
 * WHAT MAY LIVE HERE AND WHAT MAY NOT. lib/currency/describe.ts is the
 * one place currency-card PROSE lives — status headlines, limiting items,
 * remedy labels and hrefs, citations, arithmetic lines. This module never
 * rewrites any of that; it owns only what describe.ts does not export:
 * the status→badge-colour mapping, the per-type card title (types.ts says
 * the display label lives in describe.ts, but describe.ts exports no
 * per-type label today — until it does, the UI layer carries it, here,
 * in one place), and small deterministic formatters for dates the UI
 * itself introduces (the as-of line, counted-entry rows, the recompute
 * receipt). Nothing here produces a claim about currency — the engine's
 * hedged vocabulary arrives pre-worded and is rendered verbatim.
 */
import type { CurrencyStatus, CurrencyType } from "@/lib/currency/types";

/**
 * Status → Radix Badge colour. Keyed on the engine's own three-value
 * vocabulary and nothing else, so a hypothetical fourth status is a type
 * error here rather than a silently unstyled badge.
 *
 *   estimated_current      green — the product's "good" colour.
 *   estimated_not_current  red   — matches components/ui's own note that
 *                                  red is this product's "overdue / not
 *                                  current" colour.
 *   insufficient_data      amber — a CAUTION, deliberately not gray:
 *                                  "we could not find out" is
 *                                  safety-relevant information, not
 *                                  absence of information, and it must
 *                                  not fade into the chrome.
 */
export const STATUS_BADGE_COLOR: Record<CurrencyStatus, "green" | "red" | "amber"> = {
  estimated_current: "green",
  estimated_not_current: "red",
  insufficient_data: "amber",
};

/**
 * Per-type card titles and one-line descriptions.
 *
 * The KEYS are docs/PLAN.md's locked vocabulary ('passenger_day',
 * 'passenger_night', …) — legacy labels the spec explicitly says must
 * never leak into display copy: 61.57(a) is neither passenger-only nor
 * day-only (it reaches an empty repositioning leg in any two-crew
 * aircraft, at any hour — docs/CURRENCY-SPEC.md §2.1), so the
 * passenger_day card must not be titled "Passenger" or "Day". The
 * subtitles restate each requirement in the regulation's own terms —
 * calendar-month language exact, "full stop" where the text requires it —
 * and the reg citation itself renders separately on the card from
 * describe.ts's citation block, so these lines describe rather than cite.
 */
export const CURRENCY_CARD_TITLES: Record<CurrencyType, { title: string; subtitle: string }> = {
  passenger_day: {
    title: "Takeoff and landing recency",
    subtitle:
      "Required to act as PIC carrying persons, or in any aircraft certificated for more than one pilot. You need three takeoffs and three landings in the preceding 90 days, as sole manipulator of the controls, in the same category, class, and type. No time-of-day limit.",
  },
  passenger_night: {
    title: "Night takeoff and landing recency",
    subtitle:
      "Required when carrying persons between 1 hour after sunset and 1 hour before sunrise. You need three full-stop takeoffs and landings in that window, within the preceding 90 days. Not the same clock as logged night time.",
  },
  instrument: {
    title: "Instrument experience",
    subtitle:
      "In the 6 calendar months before the month of flight, complete six instrument approaches, holding procedures and tasks, and intercepting and tracking courses. Do this in actual instrument conditions, or simulated using a view-limiting device.",
  },
  flight_review: {
    title: "Flight review",
    subtitle:
      "A flight review since the beginning of the 24th calendar month before the month of flight. A proficiency check or practical test in that period may substitute under 61.56(d).",
  },
  medical: {
    title: "Medical certificate",
    subtitle:
      "Never computed. One medical certificate can carry different expiry dates for different privileges. Class, age at exam, and the operation flown all change the answer, so the only date shown here is the one you entered.",
  },
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * "DD MON YYYY" — the ops-context date style the aviation review fixes
 * ("05 AUG 2026") and the same convention lib/currency/describe.ts's own
 * (private) cardDate uses for the strings inside limiting items and
 * arithmetic lines, so a date this module formats never disagrees in
 * style with one the engine formatted a line above it.
 *
 * Pure string arithmetic on the ISO form — no Date construction — because
 * `new Date("2026-08-05")` is UTC midnight and renders as August 4th for
 * a viewer west of Greenwich (lib/format.ts's parseCalendarDate documents
 * the same trap). Returns null for anything malformed or non-existent
 * (a 29 FEB in a non-leap year is a data defect, not a date).
 */
export function formatCurrencyDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  // `?? 0` is unreachable — month is already bounded to 1..12 above — but
  // noUncheckedIndexedAccess cannot see that, and 0 fails every day.
  const daysInMonth =
    [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  if (day < 1 || day > daysInMonth) return null;
  return `${match[3]} ${MONTHS[month - 1]} ${year}`;
}

/**
 * The calendar date of an instant, in UTC — "YYYY-MM-DD". THE one as-of
 * convention this board uses, stated once: lib/currency/read.ts documents
 * that an as-of taken in the pilot's local timezone runs a day behind a
 * server-side UTC date for any client west of Greenwich after 17:00
 * local, and that mismatch is exactly how the snapshot-shadowing defect
 * in docs/CURRENCY-SPEC.md §12.9 was reproduced. Every caller on this
 * board — the page render and the recompute action — derives asOf from
 * this function so the two can never disagree with each other.
 */
export function utcDateOf(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * A timestamp as Zulu time — "1403Z on 11 AUG 2026". Aviation's reference
 * frame for instants (the terminology rules: 24-hour clock, Zulu, never
 * "2:03 PM"), used for the recompute receipt where minute-level staleness
 * is the information. Returns null for an unparseable timestamp rather
 * than rendering "NaNNaNZ".
 */
export function formatZulu(timestampIso: string): string | null {
  const t = Date.parse(timestampIso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${hh}${mm}Z on ${day} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * One counted entry's movements, as prose — "2 takeoffs, 2 landings" /
 * "3 approaches". Structural parameter rather than the CountedEntry type
 * so the test file can exercise it with plain objects.
 *
 * Zero-count parts are omitted, and an all-zero row gets an explicit
 * sentence instead of "0 takeoffs, 0 landings": the instrument card
 * counts rows for holding or for intercepting and tracking a course, and
 * such a row rendered as zeros would read as "this entry contributed
 * nothing" — the opposite of why the engine listed it.
 */
export function countedEntrySummary(entry: { takeoffs: number; landings: number; approaches: number }): string {
  const parts: string[] = [];
  if (entry.takeoffs > 0) parts.push(`${entry.takeoffs} takeoff${entry.takeoffs === 1 ? "" : "s"}`);
  if (entry.landings > 0) parts.push(`${entry.landings} landing${entry.landings === 1 ? "" : "s"}`);
  if (entry.approaches > 0) parts.push(`${entry.approaches} approach${entry.approaches === 1 ? "" : "es"}`);
  if (parts.length === 0) return "counted for a required task (holding, or intercepting and tracking a course)";
  return parts.join(", ");
}

/**
 * Next.js control-flow "errors" — redirect() and notFound() throw, and a
 * catch block that swallows them breaks navigation silently. Both the
 * page's read guard and the recompute action rethrow anything this
 * predicate matches before turning a real failure into a rendered refuse
 * state. Pure, so it lives here rather than in the "use server" module
 * (which may only export async functions).
 */
export function isNextControlFlowError(e: unknown): boolean {
  if (typeof e !== "object" || e === null || !("digest" in e)) return false;
  const digest = (e as { digest?: unknown }).digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}
