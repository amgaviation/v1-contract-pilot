/**
 * The single vocabulary for "which part of 14 CFR this flying is under."
 * Added 20260807130000 to close a regulatory-audit gap: the product had
 * no field anywhere recording Part 91 vs. Part 135, so the operator-
 * qualifications panel offered 135.293/.297/.299 rows to a pure Part 91
 * owner-flying client, and 135.301(a)'s grace month — which by its own
 * text applies only to "a crewmember who is required to take a test or
 * a flight check under this part [135]" (verified against
 * https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml
 * ?section=135.301, retrieved 2026-08-07) — was being applied to that
 * client's rows regardless. See supabase/migrations/20260807130000_
 * operating_rule.sql for the schema side of this fix.
 *
 * VALUE-SET DECISION: two operating parts, plus a client-only "varies"
 * state. A TRIP is always flown under exactly one part — a single leg
 * cannot simultaneously be a Part 91 owner flight and a Part 135 charter
 * — so TripOperatingRule is a strict two-value enum with no "both" or
 * "unspecified" escape hatch: the form always has a value to submit
 * (defaulted from the client, see below), so there is never a moment a
 * trip legitimately has no answer.
 *
 * A CLIENT is a standing relationship, and 61.57(e)(3) names PRECISELY
 * the shape this product's first market lives in: "a pilot in command
 * who is employed by a part 119 certificate holder authorized to
 * conduct operations under part 135 when the pilot is engaged in a
 * flight operation under parts 91 OR 135 for that certificate holder"
 * (verified against https://www.ecfr.gov/api/versioner/v1/full/
 * 2026-08-05/title-14.xml?section=61.57, retrieved 2026-08-07) — i.e.
 * "one client, both kinds of work" is not a hypothetical, it is the
 * exact fact pattern the currency engine (Phase 7) will need to test
 * for. So ClientOperatingRule adds 'both' for that client. It also adds
 * 'unspecified' — see the migration for why that, not a guessed part, is
 * the default for every client that existed before this column did.
 *
 * DELIBERATELY NOT ADDED: Part 91 Subpart K (fractional) and Part 121.
 * Both are real 14 CFR operating rules, but neither is a rule this
 * product's users fly under today — AMG's first market (see the
 * aviation-expert skill's contract-pilot-business reference) is
 * contract pilots working Part 91 owner-flying and Part 135 on-demand
 * charter; fractional program pilots and Part 121 airline crew are a
 * different persona with a different qualification model entirely
 * (91.1067 management-specific training, 121's whole OpSpecs/training-
 * program apparatus) that nothing else in this schema — including the
 * operator_qualifications table this field gates — models. Adding those
 * values now would be speculative: a value with no gating logic behind
 * it is worse than no value, because it invites a client to be marked
 * "91K" and then have the product silently do nothing different for
 * them. If AMG's market expands to fractional or 121 crew, that's a new
 * value added alongside new gating logic in the same change — not a
 * placeholder sitting unused today.
 */

/** What a TRIP was actually flown under — always exactly one part. */
export type TripOperatingRule = "part_91" | "part_135";

/**
 * What a CLIENT relationship covers. 'unspecified' exists ONLY as the
 * honest default for a client nobody has classified yet (see the
 * migration) — it is not a value a pilot would deliberately choose, and
 * the UI should read as "you haven't told us" rather than as a fourth
 * kind of operation.
 */
export type ClientOperatingRule = "part_91" | "part_135" | "both" | "unspecified";

export const TRIP_OPERATING_RULES: readonly {
  value: TripOperatingRule;
  label: string;
}[] = [
  { value: "part_91", label: "Part 91" },
  { value: "part_135", label: "Part 135" },
];

export const CLIENT_OPERATING_RULES: readonly {
  value: ClientOperatingRule;
  label: string;
}[] = [
  { value: "unspecified", label: "Not yet specified" },
  { value: "part_91", label: "Part 91 only" },
  { value: "part_135", label: "Part 135 only" },
  { value: "both", label: "Both — varies by trip" },
];

export const CLIENT_OPERATING_RULE_LABEL: Record<ClientOperatingRule, string> =
  Object.fromEntries(
    CLIENT_OPERATING_RULES.map((r) => [r.value, r.label])
  ) as Record<ClientOperatingRule, string>;

export const TRIP_OPERATING_RULE_LABEL: Record<TripOperatingRule, string> =
  Object.fromEntries(
    TRIP_OPERATING_RULES.map((r) => [r.value, r.label])
  ) as Record<TripOperatingRule, string>;

/**
 * Whether a client relationship includes ANY Part 135 work — the gate
 * the operator-qualifications panel uses to decide whether to show the
 * 135.293/.297/.299 rows at all. 'unspecified' reads as "not yet told
 * us" and is treated as NOT including Part 135 — the safe-default
 * reasoning in the migration header: an unclassified client should not
 * light up Part 135 currency rows it may never need.
 */
export function includesPart135(rule: ClientOperatingRule): boolean {
  return rule === "part_135" || rule === "both";
}
