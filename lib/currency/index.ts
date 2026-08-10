/**
 * The orchestrator. evaluateCurrency() ALWAYS returns exactly five
 * results, one per CurrencyType, in vocabulary order — never omits a
 * card, because an absent card reads as "fine."
 *
 * THE FLAG'S ENFORCEMENT BOUNDARY, STATED RATHER THAN LEFT SILENT: this
 * function and the rule modules it calls (general.ts, night.ts,
 * instrument.ts, flight-review.ts, medical.ts, part135.ts, match.ts,
 * window.ts, passenger-shared.ts) are PURE — no I/O, no Supabase — and
 * carry neither `import "server-only"` nor a CURRENCY_ENGINE_ENABLED
 * runtime check. That is deliberate, not an oversight: `import
 * "server-only"` throws unconditionally outside Next's own
 * server-compilation context (the "react-server" resolve condition it
 * needs is a bundler feature, not something plain Node sets), which is
 * exactly the context this repo's own unit tests run these modules under
 * — adding it here would make evaluateCurrency (and every function it
 * calls) unimportable by tests/currency.test.mjs and
 * scripts/currency-verify.mjs, both of which call these functions
 * directly, deliberately, with the flag off, to exercise the pure
 * arithmetic on its own. The actual protection this flag exists for —
 * aviation counsel reviewing CURRENCY_DISCLAIMER before a real pilot's
 * data reaches a real card — is enforced where a real pilot's data
 * actually enters the system: lib/currency/read.ts, gated by
 * assertCurrencyEngineEnabled() on every exported function, and the only
 * module in lib/currency/** that touches Supabase. A component that wants
 * a real "Estimated current" verdict still has to go through read.ts;
 * calling evaluateCurrency directly with fabricated entries is no more of
 * a bypass than fabricating any other input to any other pure function in
 * this codebase.
 */
import { isWellFormedIsoDate } from "./window";
import { evaluateGeneralExperience } from "./general";
import { evaluateNightExperience } from "./night";
import { evaluateInstrumentExperience } from "./instrument";
import { evaluateFlightReview } from "./flight-review";
import { evaluateMedical } from "./medical";
import { evaluatePart135Recency } from "./part135";
import type { TripOperatingRule } from "@/lib/operating-rule";
import type { AircraftFacts, CurrencyEntry, CurrencyResult, IsoDate } from "./types";

export class InvalidAsOfDateError extends Error {
  constructor(asOf: string) {
    super(
      `lib/currency: asOf is not a well-formed ISO date: "${asOf}". A currency answer for an unspecified date is not a hedge, it is nonsense.`
    );
    this.name = "InvalidAsOfDateError";
  }
}

export function evaluateCurrency(input: {
  asOf: IsoDate;
  airmanUserId: string;
  intendedAircraft: AircraftFacts | null;
  operatingRule: TripOperatingRule | "unspecified";
  exemptionAsserted: boolean;
  flightReviewCompletedOn: IsoDate | null;
  medicalExpiresOn: IsoDate | null;
  entries: readonly CurrencyEntry[];
  /**
   * True when the caller could not confirm `entries` is the airman's
   * whole logbook — see lib/currency/read.ts's PAGE_SIZE comment. Every
   * entries-dependent result (passenger_day, passenger_night, instrument)
   * becomes insufficient_data with "window_truncated" rather than a count
   * computed from a possibly-incomplete logbook; flight_review and
   * medical read only documents, not entries, and are unaffected.
   * Defaults to false so a caller with no notion of paging (every fixture
   * in this codebase today) keeps its current behavior.
   */
  entriesTruncated?: boolean;
}): CurrencyResult[] {
  if (!isWellFormedIsoDate(input.asOf)) throw new InvalidAsOfDateError(input.asOf);

  const { asOf, airmanUserId, intendedAircraft, operatingRule, exemptionAsserted, entries, entriesTruncated = false } =
    input;

  let general = evaluateGeneralExperience({ asOf, airmanUserId, intendedAircraft, entries });
  let night = evaluateNightExperience({ asOf, airmanUserId, intendedAircraft, entries });
  let instrument = evaluateInstrumentExperience({ asOf, airmanUserId, intendedAircraft, entries });
  const flightReview = evaluateFlightReview({ asOf, completedOn: input.flightReviewCompletedOn });
  const medical = evaluateMedical({ pilotEnteredExpiresOn: input.medicalExpiresOn });

  let part135 = evaluatePart135Recency({
    asOf,
    airmanUserId,
    operatingRule,
    exemptionAsserted,
    intendedAircraft,
    entries,
  });

  if (entriesTruncated) {
    general = truncatedResult(general);
    night = truncatedResult(night);
    instrument = truncatedResult(instrument);
    part135 = { day: truncatedResult(part135.day), night: truncatedResult(part135.night) };
  }

  const [passengerDay, passengerNight] = applyPart135Exemption({
    general,
    night,
    part135,
    operatingRule,
    exemptionAsserted,
  });

  // Vocabulary order, locked: passenger_day, passenger_night, instrument,
  // flight_review, medical.
  return [passengerDay, passengerNight, instrument, flightReview, medical];
}

/**
 * Overwrites a result computed from possibly-incomplete entries with the
 * one honest answer for that case — insufficient_data, missing exactly
 * "window_truncated", nothing else carried over from a count that cannot
 * be trusted. Never rebuilt as `{...r, status: ...}` — see part135.ts's
 * REG-1/SEC-1 fix for why partially overwriting a CurrencyResult can leave
 * it self-contradictory.
 */
function truncatedResult(r: CurrencyResult): CurrencyResult {
  return {
    currencyType: r.currencyType,
    ruleBasis: r.ruleBasis,
    status: "insufficient_data",
    window: r.window,
    required: r.required,
    observed: {},
    counted: [],
    limitingDate: null,
    throughDate: null,
    displayDate: null,
    missing: ["window_truncated"],
    notes: [],
    assumptions: [],
  };
}

/**
 * 61.57(e)(3): "This section does not apply to a pilot in command who is
 * employed by a part 119 certificate holder authorized to conduct
 * operations under part 135 when the pilot is engaged in a flight
 * operation under parts 91 or 135 for that certificate holder if the
 * pilot in command is in compliance with §§ 135.243 and 135.247." The
 * exemption disapplies THE WHOLE of 61.57 (not just (a) and (b), unlike
 * the part 125 case at (e)(1)) — but it is ASSERTED, never inferred (see
 * docs/CURRENCY-SPEC.md §2.5, counsel question C-2: whether "employed by"
 * reaches a 1099 contract pilot is a question this product does not
 * answer), and this function never suppresses a not-current 61.57
 * verdict; it relabels it and keeps the underlying number visible in
 * notes[].
 *
 * BRANCHING (docs/CURRENCY-SPEC.md §2.5's table):
 *   part_135 + asserted    -> 135.247 SUBSTITUTES for 61.57(a)/(b), with
 *                              the 61.57 verdict attached as a note.
 *   part_135 + not asserted -> plain 61.57, with a note that the (e)(3)
 *                              path is available if asserted.
 *   part_91  + asserted    -> plain 61.57 stays primary (135.247 governs
 *                              Part 135 operations, not this leg's own
 *                              part), but relabelled: (e)(3) reaches "a
 *                              flight operation under parts 91 or 135 for
 *                              that certificate holder," so the note
 *                              still applies.
 *   unspecified             -> plain 61.57, no (e)(3) note — the
 *                              certificate-holder relationship needed to
 *                              reason about (e)(3) at all is not known.
 */
function applyPart135Exemption(args: {
  general: CurrencyResult;
  night: CurrencyResult;
  part135: { day: CurrencyResult; night: CurrencyResult };
  operatingRule: TripOperatingRule | "unspecified";
  exemptionAsserted: boolean;
}): [CurrencyResult, CurrencyResult] {
  const { general, night, part135, operatingRule, exemptionAsserted } = args;

  if (operatingRule === "part_135" && exemptionAsserted) {
    return [
      relabelUnder135(part135.day, general, "61.57(a)"),
      relabelUnder135(part135.night, night, "61.57(b)"),
    ];
  }

  let note: string | null = null;
  if (operatingRule === "part_135" && !exemptionAsserted) {
    note =
      "61.57(e)(3) may be available: if you assert your Part 135 exemption for this client, 135.247 recency is computed instead of this result.";
  } else if (exemptionAsserted) {
    // part_91 (or unspecified) with the exemption asserted anyway — (e)(3)
    // reaches "a flight operation under parts 91 or 135 for that
    // certificate holder," so the note still applies even off a Part 135
    // leg.
    note =
      "Under 61.57(e)(3), this requirement may not apply while you are engaged in a flight operation under parts 91 or 135 for the certificate holder you asserted the exemption for.";
  }

  return [withNote(general, note), withNote(night, note)];
}

function withNote(result: CurrencyResult, note: string | null): CurrencyResult {
  return note ? { ...result, notes: [...result.notes, note] } : result;
}

function relabelUnder135(
  primary: CurrencyResult,
  underlying: CurrencyResult,
  section: "61.57(a)" | "61.57(b)"
): CurrencyResult {
  const underlyingSummary =
    underlying.status === "insufficient_data"
      ? `${section}: not enough information to evaluate directly.`
      : `${section}: estimated ${underlying.status === "estimated_current" ? "current" : "not current"} on its own arithmetic.`;
  return {
    ...primary,
    notes: [
      ...primary.notes,
      `Computed under 135.247 per your asserted 61.57(e)(3) exemption; ${section} may not apply. ${underlyingSummary} 61.57(e)(3) also requires compliance with 135.243, which this engine does not evaluate.`,
    ],
  };
}
