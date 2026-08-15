/**
 * Pure assembly for the year-end travel log — no I/O, no Supabase, no Next
 * imports, so tests/travel-log.test.mjs can exercise it directly (the same
 * split as app/(app)/reports/sales-tax/report-lib.ts and
 * app/(app)/clients/[id]/statement/statement-lib.ts).
 *
 * WHAT THIS IS: a contemporaneous business-travel log for the pilot's tax
 * preparer, built from the trip days the pilot already captured — one row
 * per pilot.trip_days row dated in the tax year: the date, the client, the
 * day type, whether the pilot was away from home base, and the route flown
 * that day (from pilot.trip_legs). Plus the two counts a CPA doing a
 * Schedule C per-diem computation asks for: away days, and away days whose
 * day type counts for per diem.
 *
 * WHAT THIS DELIBERATELY IS NOT: a dollar figure. The M&IE rate is the
 * pilot's (or their CPA's) to enter and apply — the same rule as
 * pilot.mileage_rates: never hardcode an IRS/GSA figure, and here not even
 * a pilot-entered one exists (no schema for it), so this export carries
 * DAY COUNTS ONLY and says so. Computing the deduction would put a number
 * on a document headed for a tax filing that this product has no basis
 * for. Substantiation, not advice.
 *
 * PER-DIEM ELIGIBILITY is the same AND the invoice draft applies
 * (app/(app)/invoices/actions.ts): counts_for_per_diem on the DAY TYPE and
 * away on the DAY — never either alone.
 *
 * CANCELED TRIPS: a day row belonging to a canceled trip is excluded from
 * the log (travel that was scrubbed is not business travel to
 * substantiate), but COUNTED and surfaced — silently dropping rows from a
 * document headed for a preparer is the defect class lib/supabase/rows.ts
 * exists to close, applied to a filter instead of a read.
 */

// ---------------------------------------------------------------------------
// Input row shapes — the columns the loader reads, nothing more.
// ---------------------------------------------------------------------------

/** One pilot.trip_days row dated inside the tax year. */
export type TravelLogTripDay = {
  id: string;
  trip_id: string;
  day_on: string;
  day_type_id: string;
  away: boolean;
};

/** pilot.trips rows for every trip_id the day rows reference. */
export type TravelLogTrip = {
  id: string;
  client_id: string | null;
  status: "scheduled" | "in_progress" | "completed" | "canceled";
  aircraft_ident: string | null;
};

/** pilot.day_types rows — the tenant's own day-type taxonomy. */
export type TravelLogDayType = {
  id: string;
  label: string;
  counts_for_per_diem: boolean;
};

/** pilot.trip_legs rows for the same trips, dated inside the year. */
export type TravelLogLeg = {
  id: string;
  trip_id: string;
  leg_date: string;
  from_icao: string | null;
  to_icao: string | null;
  out_at: string | null;
};

export type TravelLogRow = {
  /** The pilot.trip_days row id — a stable render key, nothing more. */
  id: string;
  dayOn: string;
  tripId: string;
  clientName: string;
  dayTypeLabel: string;
  away: boolean;
  /** away AND the day type counts for per diem — the invoice draft's rule. */
  perDiemDay: boolean;
  /** "KTEB–KPBI · KPBI–KTEB", or null when no leg was flown that day
   *  (travel and standby days legitimately have none). */
  route: string | null;
  aircraftIdent: string | null;
};

export type TravelLogAssembly =
  | { ok: false; reason: string }
  | {
      ok: true;
      rows: TravelLogRow[];
      /** Rows with away=true. */
      awayDayCount: number;
      /** Rows with away=true AND a per-diem day type — the count the
       *  pilot's CPA multiplies by their M&IE rate. Never a dollar figure
       *  here; see the file header. */
      perDiemDayCount: number;
      /** Day rows excluded because their trip is canceled — surfaced,
       *  never silently dropped. */
      canceledDayCount: number;
    };

/** One leg as the log prints it: "KTEB–KPBI". A missing end shows as "—"
 *  rather than being invented. */
function legLabel(leg: TravelLogLeg): string {
  return `${leg.from_icao ?? "—"}–${leg.to_icao ?? "—"}`;
}

/**
 * Joins the reads into per-day rows + counts, refusing — never printing a
 * partial log as though complete — whenever a row it must print references
 * a record the lookup didn't return (the lib/supabase/rows.ts house rule,
 * applied to the join rather than the read).
 */
export function assembleTravelLog(input: {
  tripDays: TravelLogTripDay[];
  trips: TravelLogTrip[];
  dayTypes: TravelLogDayType[];
  legs: TravelLogLeg[];
  /** id → name for every client a trip references. */
  clientNames: Map<string, string>;
}): TravelLogAssembly {
  const tripById = new Map(input.trips.map((t) => [t.id, t]));
  const dayTypeById = new Map(input.dayTypes.map((d) => [d.id, d]));

  // Legs grouped by (trip, date), ordered within the day by out_at when
  // present (a same-day out-and-back must print its legs in flown order),
  // then id for a total, stable order when times weren't recorded.
  const legsByTripDay = new Map<string, TravelLogLeg[]>();
  for (const leg of input.legs) {
    const key = `${leg.trip_id}:${leg.leg_date}`;
    const existing = legsByTripDay.get(key);
    if (existing) existing.push(leg);
    else legsByTripDay.set(key, [leg]);
  }
  for (const dayLegs of legsByTripDay.values()) {
    dayLegs.sort((a, b) => {
      if (a.out_at !== null && b.out_at !== null && a.out_at !== b.out_at) {
        return a.out_at.localeCompare(b.out_at);
      }
      // A timed leg sorts before an untimed one on the same day.
      if ((a.out_at === null) !== (b.out_at === null)) {
        return a.out_at === null ? 1 : -1;
      }
      return a.id.localeCompare(b.id);
    });
  }

  const rows: TravelLogRow[] = [];
  let canceledDayCount = 0;

  for (const day of input.tripDays) {
    const trip = tripById.get(day.trip_id);
    if (!trip) {
      // A trip_days row always hangs off a trips row (FK), so a missing
      // match means the trips lookup came back short — refuse rather than
      // dropping days from a log whose whole value is completeness.
      return {
        ok: false,
        reason: `trip day ${day.id} references trip ${day.trip_id} which the trips read didn't return, refusing to print a partial travel log`,
      };
    }
    if (trip.status === "canceled") {
      canceledDayCount += 1;
      continue;
    }
    const dayType = dayTypeById.get(day.day_type_id);
    if (!dayType) {
      // Same FK reasoning: day_type_id always references a day_types row
      // (archived types are still rows), so absence means a short read.
      return {
        ok: false,
        reason: `trip day ${day.id} references day type ${day.day_type_id} which the day-types read didn't return, refusing to print a partial travel log`,
      };
    }

    const dayLegs = legsByTripDay.get(`${day.trip_id}:${day.day_on}`) ?? [];
    const clientName =
      trip.client_id === null
        ? "No client"
        : input.clientNames.get(trip.client_id) ?? "Unknown client";

    rows.push({
      id: day.id,
      dayOn: day.day_on,
      tripId: day.trip_id,
      clientName,
      dayTypeLabel: dayType.label,
      away: day.away,
      perDiemDay: day.away && dayType.counts_for_per_diem,
      route: dayLegs.length ? dayLegs.map(legLabel).join(" · ") : null,
      aircraftIdent: trip.aircraft_ident,
    });
  }

  rows.sort(
    (a, b) =>
      // ISO dates sort lexically, so string comparison is date comparison.
      a.dayOn.localeCompare(b.dayOn) ||
      a.clientName.localeCompare(b.clientName) ||
      a.tripId.localeCompare(b.tripId)
  );

  // Counts are counts of the rows shown and of nothing else, so a reader
  // tallying the printed Away column by hand always reconciles — the same
  // rule the money reports apply to their totals.
  const awayDayCount = rows.reduce((n, r) => n + (r.away ? 1 : 0), 0);
  const perDiemDayCount = rows.reduce((n, r) => n + (r.perDiemDay ? 1 : 0), 0);

  return { ok: true, rows, awayDayCount, perDiemDayCount, canceledDayCount };
}
