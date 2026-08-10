/**
 * Card copy this module owns outright: status headlines, missing-input
 * remedy labels/hrefs, citations, and the "Window / Entries counted / Rule
 * applied" arithmetic lines. It does NOT own every user-facing string in
 * lib/currency/** — general.ts, night.ts, instrument.ts, flight-review.ts,
 * medical.ts, part135.ts and index.ts each write their own notes[] and
 * assumptions[] sentences, because those are regulation-specific
 * disclosures the module computing the result is best placed to word.
 * describeResult renders those strings verbatim (see arithmeticFor below)
 * — it does not generate them, and a counsel review scoped to this file
 * alone does not cover them. Still pure: no I/O, no JSX.
 */
import { parseCalendarDate } from "@/lib/format";
import type { CurrencyResult, MissingInput, RuleBasis } from "./types";

// docs/CURRENCY-SPEC.md's own fetch/retrieval dates — the text every
// citation in this engine was built from.
const ISSUE_DATE = "2026-08-05";
const RETRIEVED_ON = "2026-08-10";

const CITATIONS: Record<RuleBasis, { section: string; url: string }> = {
  "61.57(a)": { section: "14 CFR 61.57(a)", url: "https://www.ecfr.gov/current/title-14/section-61.57" },
  "61.57(b)": { section: "14 CFR 61.57(b)", url: "https://www.ecfr.gov/current/title-14/section-61.57" },
  "61.57(c)": { section: "14 CFR 61.57(c)", url: "https://www.ecfr.gov/current/title-14/section-61.57" },
  "61.56": { section: "14 CFR 61.56", url: "https://www.ecfr.gov/current/title-14/section-61.56" },
  "61.23": { section: "14 CFR 61.23(d)", url: "https://www.ecfr.gov/current/title-14/section-61.23" },
  "135.247(a)(1)": { section: "14 CFR 135.247(a)(1)", url: "https://www.ecfr.gov/current/title-14/section-135.247" },
  "135.247(a)(2)": { section: "14 CFR 135.247(a)(2)", url: "https://www.ecfr.gov/current/title-14/section-135.247" },
};

// Never "current" / "legal" / "compliant" — "estimated" is the whole claim.
const HEADLINES: Record<CurrencyResult["status"], string> = {
  estimated_current: "Estimated current",
  estimated_not_current: "Estimated not current",
  insufficient_data: "Not enough information",
};

/**
 * "DD MON YYYY" — the style docs/CURRENCY-SPEC.md's own worked examples
 * use throughout ("01 FEB 2026", "31 AUG 2026"). Deliberately not
 * lib/format.ts's formatDate ("Aug 5, 2026"), which is that module's
 * house style for documents/invoices elsewhere in the product — a
 * different screen, a different convention, and this file is the one
 * place currency-card prose is written.
 */
function cardDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = parseCalendarDate(iso);
  if (!d) return null;
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
  return `${day} ${month} ${d.getUTCFullYear()}`;
}

/** Names WHICH field is missing and WHERE to enter it — "not enough information" with no remedy trains a pilot to ignore the panel. */
const MISSING_INPUT_COPY: Record<MissingInput, { label: string; href: string }> = {
  airman_unattributed: {
    label: "One or more entries in this window aren't attributed to an airman — assign them in the logbook.",
    href: "/logbook",
  },
  role_unrecorded: {
    label: "Record your role (PIC/SIC/SOLO) on the entries in this window.",
    href: "/logbook",
  },
  sole_manipulator_unrecorded: {
    label: "Record whether you were sole manipulator of the controls on the entries in this window.",
    href: "/logbook",
  },
  intended_aircraft_absent: {
    label: "Choose the aircraft you intend to fly.",
    href: "/logbook/aircraft",
  },
  aircraft_unregistered: {
    label: "Register the aircraft flown on entries in this window with takeoffs or landings.",
    href: "/logbook/aircraft",
  },
  aircraft_gear_unrecorded: {
    label: "Record whether the intended aircraft is tailwheel, and the gear on any aircraft flown in this window — it changes which takeoffs and landings count.",
    href: "/logbook/aircraft",
  },
  aircraft_category_class_unrecorded: {
    // Two distinct causes share this code: the INTENDED aircraft's own
    // category/class is blank (this card's notes will be empty), or an
    // entry whose ambiguous category could be the difference between
    // current and not (that entry is named in this card's notes). Worded
    // to be true in EITHER case — never claiming a note exists when it
    // does not (P4).
    label: "Record the intended aircraft's category and class — or, if those are already recorded, check this card's notes for an entry whose category could not be matched against it.",
    href: "/logbook/aircraft",
  },
  aircraft_type_unrecorded: {
    // Same two-cause shape as aircraft_category_class_unrecorded above:
    // the INTENDED aircraft's own type rating/designator is blank (no
    // note), or a SPECIFIC entry's type is unresolved and could change
    // the answer (named in this card's notes). P4: the old wording named
    // only the first cause, which cannot be fixed by "recording the
    // intended aircraft's type" when it is already recorded and a
    // different entry is the actual reason.
    label: "Record the intended aircraft's type rating or type designator — or, if those are already recorded, check this card's notes for an entry whose type could not be matched against it.",
    href: "/logbook/aircraft",
  },
  night_window_unasserted: {
    label: "Confirm which night takeoffs/landings fell inside the 1-hour-after-sunset to 1-hour-before-sunrise period.",
    href: "/logbook",
  },
  approach_condition_unrecorded: {
    label: "Record whether each approach was flown in actual or simulated instrument conditions.",
    href: "/logbook",
  },
  unresolvable_simulator_row: {
    label: "A simulator session in this window can't be credited without its device class and course details.",
    href: "/logbook",
  },
  device_category_unconfirmed: {
    label: "A simulator/device session named in this card's notes could be the difference between current and not, and this schema has no field recording whether the device represents the category of aircraft for the instrument rating being maintained (61.57(c)(2)) — resolve it manually.",
    href: "/logbook",
  },
  operating_rule_unspecified: {
    label: "Set the operating rule on this client or trip.",
    href: "/clients",
  },
  flight_review_completion_absent: {
    label: "Enter the date of your last flight review.",
    href: "/documents",
  },
  flight_review_completion_in_future: {
    label: "The flight review completion date entered is in the future — correct it.",
    href: "/documents",
  },
  medical_never_computed: {
    label: "This is never computed from your medical document — see the note on this card.",
    href: "/documents",
  },
  window_truncated: {
    label: "Too many entries to load in one request — contact support.",
    href: "/logbook",
  },
};

export function describeResult(r: CurrencyResult): {
  headline: string;
  limitingItem: string;
  arithmetic: string[];
  remedies: { missing: MissingInput; label: string; href: string }[];
  citation: { section: string; url: string; issueDate: string; retrievedOn: string };
} {
  return {
    headline: HEADLINES[r.status],
    limitingItem: limitingItemFor(r),
    arithmetic: arithmeticFor(r),
    remedies: r.missing.map((m) => ({ missing: m, ...MISSING_INPUT_COPY[m] })),
    citation: { ...CITATIONS[r.ruleBasis], issueDate: ISSUE_DATE, retrievedOn: RETRIEVED_ON },
  };
}

function limitingItemFor(r: CurrencyResult): string {
  if (r.status === "insufficient_data") return "Not enough information to evaluate.";

  if (r.currencyType === "flight_review") {
    return r.throughDate ? `Flight review valid through ${cardDate(r.throughDate)}.` : "No through-date computed.";
  }

  if (r.currencyType === "instrument") {
    const approaches = r.observed.approaches ?? 0;
    const required = r.required.approaches ?? 6;
    const since = r.window ? cardDate(r.window.start) : null;
    return `${approaches} of ${required} approaches${since ? ` since ${since}` : ""}.`;
  }

  const takeoffs = r.observed.takeoffs ?? 0;
  const landings = r.observed.landings ?? 0;
  const requiredTakeoffs = r.required.takeoffs ?? 3;
  const requiredLandings = r.required.landings ?? 3;
  const limiting = r.limitingDate ? ` — earliest qualifying entry ${cardDate(r.limitingDate)}` : "";
  return `${takeoffs} of ${requiredTakeoffs} takeoffs, ${landings} of ${requiredLandings} landings${limiting}.`;
}

function arithmeticFor(r: CurrencyResult): string[] {
  const lines: string[] = [];
  if (r.window) {
    lines.push(`Window: ${cardDate(r.window.start)} through ${cardDate(r.window.end)}.`);
  }
  lines.push(`Entries counted: ${r.counted.length}.`);
  lines.push(`Rule applied: ${r.ruleBasis}.`);
  for (const a of r.assumptions) lines.push(a);
  for (const n of r.notes) lines.push(n);
  return lines;
}
