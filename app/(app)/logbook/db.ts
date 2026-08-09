import type { createClient } from "@/lib/supabase/server";

/**
 * logbook_entries / logbook_import_batches / logbook_source_files (added by
 * supabase/migrations/20260805220000_phase6_logbook.sql) are not yet
 * represented in lib/supabase/database.types.ts. That file is hand-authored
 * and, per its own header comment, kept in lockstep with migrations "by
 * hand" — normally each phase updates it. This phase's task boundary is
 * explicitly `app/(app)/logbook/**` plus the migration file ONLY (lib/* is
 * owned elsewhere and other agents are editing sibling feature directories
 * concurrently), so this file is the narrow, local escape hatch instead:
 * it does NOT loosen the shared typed client for every other table (trips,
 * expenses, clients, ... all stay fully checked), it only lets these three
 * new table names through `.from()`.
 *
 * Every payload sent through `logbookFrom` is still typed against the
 * Row/Insert/Update shapes below BEFORE it reaches here, mirroring the
 * house "type the payload as Insert/Update, then cast" discipline used
 * everywhere else in this app (e.g. app/(app)/trips/actions.ts) — the
 * difference is only that the source of truth for the shape is this file
 * instead of the generated one, until whoever owns lib/* regenerates it
 * from supabase/migrations/20260805220000_phase6_logbook.sql.
 */

export type PilotClient = Awaited<ReturnType<typeof createClient>>;

export type LogbookTableName =
  | "logbook_entries"
  | "logbook_import_batches"
  | "logbook_source_files";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function logbookFrom(supabase: PilotClient, table: LogbookTableName): any {
  return (supabase as unknown as { from: (t: string) => unknown }).from(table);
}

export type LogbookSource = "trip" | "import" | "manual" | "foreflight_sync";
// PIC/SIC per 61.51(e)/(f); SOLO per 61.51(d) — sole occupant; DUAL_RECEIVED
// per 61.51(h) — training received from an authorized instructor.
// Deliberately no DUAL_GIVEN value — an instructor's dual given is the
// flight_instructor_time column, not a role. See
// supabase/migrations/20260809000000_logbook_role_vocabulary.sql.
export type LogbookRole = "PIC" | "SIC" | "SOLO" | "DUAL_RECEIVED";
// 'ffs' = full flight simulator — the only device class 61.57(b)(2) accepts
// for NIGHT takeoff/landing currency; 'ftd' and 'atd' cover 61.57(a) day
// currency (ftd only) and 61.57(c) instrument currency (atd) respectively.
// See supabase/migrations/20260807120000_logbook_reg_corrections.sql.
export type SimulatorDeviceType = "ffs" | "ftd" | "atd" | "other";
export type ApproachType =
  | "ils"
  | "rnav_lpv"
  | "rnav_lnav"
  | "vor"
  | "loc"
  | "ndb"
  | "visual"
  | "other";
// 61.57(c)(1): the condition an approach was flown under, distinct from
// approach_type (the procedure flown). 'actual' = actual instrument/IMC
// weather conditions; 'simulated' = under a view-limiting device (hood,
// foggles, or a qualifying simulator per 61.57(c)(2)); 'neither' = flown in
// neither condition (e.g. a visual approach in VMC) — a real, asserted,
// DISQUALIFYING fact, not the same as null. null/undefined means unknown —
// every row from before this column existed (20260807140000) reads this
// way and must not be treated as either qualifying or disqualifying. See
// that migration's column comment for the full reasoning.
export type ApproachCondition = "actual" | "simulated" | "neither";

/** Mirrors pilot.logbook_entries exactly — keep in lockstep with the migration. */
export type LogbookEntryRow = {
  id: string;
  account_id: string;
  source: LogbookSource;
  // The account_members.user_id who flew this entry. Set server-side from
  // the session on every insert path (see actions.ts); never
  // client-supplied and never UPDATE-writable — see the
  // 20260807050000_logbook_airman_and_export.sql header. NULL only on a
  // pre-existing row that predates this column on a multi-member account
  // (see that migration's backfill note).
  airman_user_id: string | null;
  trip_id: string | null;
  trip_leg_id: string | null;
  import_batch_id: string | null;
  source_file_id: string | null;
  source_row_number: number | null;
  row_fingerprint: string | null;
  source_row: unknown;
  foreflight_sync_id: string | null;
  entry_date: string;
  aircraft_ident: string | null;
  aircraft_type: string | null;
  from_icao: string | null;
  to_icao: string | null;
  role: LogbookRole;
  total_time: number;
  pic_time: number | null;
  sic_time: number | null;
  solo_time: number | null;
  cross_country_time: number | null;
  night_time: number | null;
  instrument_actual_time: number | null;
  instrument_simulated_time: number | null;
  flight_instructor_time: number | null;
  dual_received_time: number | null;
  simulator_time: number | null;
  simulator_device_type: SimulatorDeviceType | null;
  day_takeoffs: number;
  day_landings_full_stop: number;
  day_landings_touch_go: number;
  night_takeoffs: number;
  night_landings_full_stop: number;
  night_landings_touch_go: number;
  approaches_count: number;
  approach_type: ApproachType | null;
  // See ApproachCondition's comment above. Nullable — unknown is the honest
  // default, not a value on the reg's own scale.
  approach_condition: ApproachCondition | null;
  // 61.57(c)(1)(iii): "Intercepting and tracking courses through the use
  // of navigational electronic systems" — a required instrument-currency
  // task with no prior field. Boolean, not a count: the reg states it as
  // a task performed on the flight, not a repetition count.
  courses_intercepted_tracked: boolean;
  holds: number;
  // 61.51(b)(1)(v): "The name of a safety pilot, if required by
  // Section 91.109." Nullable — only required on a subset of
  // simulated-instrument flights; the app surfaces it as a prompt when
  // instrument_simulated_time > 0, not a hard requirement.
  view_limiting_pilot_name: string | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
};

/** The columns a `source='manual'` create/edit form is allowed to write. */
export type LogbookEntryFlightFields = Pick<
  LogbookEntryRow,
  | "entry_date"
  | "aircraft_ident"
  | "aircraft_type"
  | "from_icao"
  | "to_icao"
  | "role"
  | "total_time"
  | "pic_time"
  | "sic_time"
  | "solo_time"
  | "cross_country_time"
  | "night_time"
  | "instrument_actual_time"
  | "instrument_simulated_time"
  | "flight_instructor_time"
  | "dual_received_time"
  | "simulator_time"
  | "simulator_device_type"
  | "day_takeoffs"
  | "day_landings_full_stop"
  | "day_landings_touch_go"
  | "night_takeoffs"
  | "night_landings_full_stop"
  | "night_landings_touch_go"
  | "approaches_count"
  | "approach_type"
  | "approach_condition"
  | "courses_intercepted_tracked"
  | "holds"
  | "view_limiting_pilot_name"
  | "remarks"
>;

export type LogbookEntryInsert = LogbookEntryFlightFields & {
  account_id: string;
  source: LogbookSource;
  // Required, not optional: every insert path must state whose logbook
  // this is (from requireAccount()'s `user.id`) — there is no default
  // that would be safe to guess. See the migration header for why.
  airman_user_id: string;
  trip_id?: string | null;
  trip_leg_id?: string | null;
};

export type LogbookEntryUpdate = Partial<LogbookEntryFlightFields>;

/** The subset of pilot.trip_legs a draft is derived from. */
export type DraftLegRow = {
  id: string;
  trip_id: string;
  leg_date: string;
  from_icao: string | null;
  to_icao: string | null;
  block_hours: number | null;
  night_hours: number | null;
  instrument_hours: number | null;
  day_landings: number;
  night_takeoffs: number;
  night_landings_full_stop: number;
  night_landings_touch_go: number;
  approaches: number;
  holds: number;
};

export type DraftTripRow = {
  id: string;
  starts_on: string;
  ends_on: string;
  aircraft_ident: string | null;
  aircraft_type: string | null;
  status: string;
};

/**
 * The proposal itself, computed from a trip + one of its legs — never
 * stored. See the confirm-draft flow in actions.ts and the file header of
 * the Phase 6 migration for why this is intentionally NOT a table.
 *
 * total_time defaults to the leg's block_hours (the closest thing
 * trip_legs records to a flight time), falling back to 0 when block_hours
 * is null: the column is NOT NULL on logbook_entries, and a visible,
 * editable 0 is honest where a rejected insert would just be confusing.
 *
 * `role` is NOT guessed here — it used to default to "PIC" on the
 * assumption a contract-pilot trip is flown from the left seat, but
 * trip_legs never actually records who occupied which seat, and a
 * two-crew trip flown as SIC would have every leg silently confirmed as
 * PIC into a record that is supposed to be legally defensible. `role` is
 * now a required parameter the caller (the drafts review screen, via
 * confirmLegDraft/confirmTripDrafts) must supply from an explicit pilot
 * choice — the same "the draft-confirm boundary exists exactly so a
 * human resolves this rather than the software guessing" principle the
 * instrument/day-landings fields below already follow. pic_time/sic_time
 * are derived from whichever role is asserted, mirroring total_time —
 * both stay freely editable after confirming.
 */
/**
 * Notes the leg facts the logbook's schema is more precise about than
 * trip_legs is, so the pilot can place them during review instead of the
 * draft asserting a classification the trip never captured.
 */
function buildDraftRemarks(leg: {
  day_landings: number | null;
  instrument_hours: number | null;
}): string | null {
  const notes: string[] = [];
  if (leg.day_landings) {
    notes.push(
      `${leg.day_landings} day landing${leg.day_landings === 1 ? "" : "s"} on the trip leg (full-stop vs touch-and-go not recorded)`
    );
  }
  if (leg.instrument_hours) {
    notes.push(
      `${leg.instrument_hours} instrument hours on the trip leg (actual vs simulated not recorded)`
    );
  }
  return notes.length ? `From trip: ${notes.join("; ")}.` : null;
}

export function draftPayloadForLeg(
  trip: DraftTripRow,
  leg: DraftLegRow,
  role: LogbookRole
): LogbookEntryFlightFields & { trip_id: string; trip_leg_id: string } {
  const totalTime = leg.block_hours ?? 0;
  return {
    entry_date: leg.leg_date,
    aircraft_ident: trip.aircraft_ident,
    aircraft_type: trip.aircraft_type,
    from_icao: leg.from_icao,
    to_icao: leg.to_icao,
    role,
    total_time: totalTime,
    pic_time: role === "PIC" ? totalTime : null,
    sic_time: role === "SIC" ? totalTime : null,
    solo_time: null,
    cross_country_time: null,
    night_time: leg.night_hours ?? 0,
    // NOT mapped to instrument_actual_time. pilot.trip_legs records one
    // undifferentiated `instrument_hours`; the logbook separates ACTUAL
    // (in IMC) from SIMULATED (hood//view-limiting device), and the trip
    // never recorded which. Asserting "actual" would put a fact the pilot
    // never stated into the record they may have to defend, so the draft
    // leaves both null and carries the number into remarks for the pilot
    // to place. The draft-confirm boundary exists exactly so a human
    // resolves this rather than the software guessing.
    instrument_actual_time: null,
    instrument_simulated_time: null,
    flight_instructor_time: null,
    dual_received_time: null,
    simulator_time: null,
    simulator_device_type: null,
    // trip_legs has no day-takeoff count at all (61.57(a) gap; see the
    // Phase 6-corrections migration) — leaves 0 rather than guessing, same
    // "the draft-confirm boundary is where a human resolves this" posture
    // as everything else below.
    day_takeoffs: 0,
    // Same problem, sharper: trip_legs has a single `day_landings`
    // count, while the logbook splits full-stop from touch-and-go
    // because tailwheel currency (61.57(a)) turns on full-stop landings
    // specifically. Filling full_stop with the total would silently
    // manufacture currency the pilot may not have. Both stay zero and
    // the count goes to remarks.
    day_landings_full_stop: 0,
    day_landings_touch_go: 0,
    night_takeoffs: leg.night_takeoffs ?? 0,
    night_landings_full_stop: leg.night_landings_full_stop ?? 0,
    night_landings_touch_go: leg.night_landings_touch_go ?? 0,
    approaches_count: leg.approaches ?? 0,
    approach_type: null,
    // trip_legs has no field for 61.57(c)(1) condition either (actual vs.
    // simulated vs. neither) — left null (unknown), not guessed, same
    // "the draft-confirm boundary is where a human resolves this" posture
    // as approach_type and everything else below.
    approach_condition: null,
    // trip_legs has no field for 61.57(c)(1)(iii)'s intercept/track task
    // either — false, not guessed true, same reasoning as day_takeoffs.
    courses_intercepted_tracked: false,
    holds: leg.holds ?? 0,
    // trip_legs has no safety-pilot field; leave for the pilot to fill in
    // during review, same as the other facts this draft cannot assert.
    view_limiting_pilot_name: null,
    // Carries forward the two facts the trip recorded but could not
    // classify, so confirming a draft never loses data — it just refuses
    // to guess where it belongs.
    remarks: buildDraftRemarks(leg),
    trip_id: trip.id,
    trip_leg_id: leg.id,
  };
}
