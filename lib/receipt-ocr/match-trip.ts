/**
 * Which trip does this receipt belong to?
 *
 * ***************************************************************************
 * WHY THIS IS THE PART OF RECEIPT SCANNING THAT ACTUALLY MATTERS
 * ***************************************************************************
 * Reading "$3,371.90" off a fuel invoice saves a pilot eight keystrokes.
 * Working out that the invoice belongs to the Teterboro trip on the 15th is
 * the thing they otherwise do from memory, days later, with a shoebox of
 * paper — and it is the decision that determines whether the charge gets
 * rebilled to a client or silently absorbed. That is real money, and it is
 * this product's whole thesis: one capture, many outputs.
 *
 * An FBO invoice is unusually good at this. Unlike a hotel folio or a
 * rideshare receipt, it prints the TAIL NUMBER, because the aircraft is
 * what was serviced. A tail number plus a date is very close to a primary
 * key for a contract pilot's trip list.
 *
 * ***************************************************************************
 * WHAT IT WILL NOT DO
 * ***************************************************************************
 * It will not pick between two candidates. If a pilot flew N447SP twice in
 * March and the receipt's date is unreadable, both trips match and the
 * answer is "two trips flew N447SP — which one?", not a coin flip. A
 * wrongly-attached receipt is worse than an unattached one: unattached, it
 * sits in the unassigned queue, which is a first-class surface in this
 * product precisely so those get worked. Wrongly attached, it lands on
 * someone's invoice.
 *
 * It also never returns a trip on the strength of a date alone. Every trip
 * that overlaps a given day would match, and "you were on a trip that week"
 * is not evidence about a particular receipt.
 */

export type MatchableTrip = {
  id: string;
  label: string;
  /** The trip's aircraft, as the pilot entered it. May be absent. */
  aircraftIdent: string | null;
  startsOn: string;
  endsOn: string;
};

export type TripMatch =
  | { kind: "none" }
  | { kind: "one"; trip: MatchableTrip; because: string }
  | { kind: "several"; trips: MatchableTrip[]; because: string };

/**
 * Tail numbers are written inconsistently by everyone — "N447SP", "N-447SP",
 * "n447sp" — and an FBO's billing system is not more careful than a pilot
 * typing into a form. Compared without punctuation or case.
 */
function canonical(ident: string): string {
  return ident.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/** Inclusive, on ISO dates, compared as strings — no Date is constructed. */
function within(day: string, startsOn: string, endsOn: string): boolean {
  return day >= startsOn && day <= endsOn;
}

/**
 * Days either side of a trip's own dates that still count as "during" it.
 *
 * A fuel uplift on the morning of departure, a hotel folio settled the day
 * after the last leg, a rental car returned on the way home: all routinely
 * fall a day outside the trip's logged range, and refusing them would make
 * the feature miss the receipts pilots most want attached. Two days is
 * wide enough for a red-eye return and narrow enough that it cannot reach
 * a different trip on the same tail without producing a "several" result
 * the pilot resolves themselves.
 */
const EDGE_DAYS = 2;

function shifted(isoDay: string, days: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  if (!y || !m || !d) return isoDay;
  // UTC arithmetic on a date-only value: no timezone can shift it, which
  // is the same reason nothing else in this codebase builds a local Date
  // from an ISO day.
  const at = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const out = new Date(at);
  return `${out.getUTCFullYear()}-${String(out.getUTCMonth() + 1).padStart(2, "0")}-${String(
    out.getUTCDate()
  ).padStart(2, "0")}`;
}

export function matchTrip(
  trips: readonly MatchableTrip[],
  receipt: { aircraftIdent: string | null; date: string | null }
): TripMatch {
  if (!receipt.aircraftIdent) return { kind: "none" };

  const tail = canonical(receipt.aircraftIdent);
  const sameAircraft = trips.filter(
    (trip) => trip.aircraftIdent && canonical(trip.aircraftIdent) === tail
  );
  if (sameAircraft.length === 0) return { kind: "none" };

  const shown = receipt.aircraftIdent.toUpperCase();

  // No date to check against. One candidate is still the only candidate,
  // so it is offered — but the missing evidence is said out loud rather
  // than presented as a confirmed match.
  if (!receipt.date) {
    if (sameAircraft.length === 1) {
      return {
        kind: "one",
        trip: sameAircraft[0]!,
        because: `${shown} is on the receipt and you flew it on one trip, but the scan couldn't read a date, so check this is the right one.`,
      };
    }
    return {
      kind: "several",
      trips: sameAircraft,
      because: `${sameAircraft.length} trips flew ${shown}, and the scan couldn't read a date: pick the right one.`,
    };
  }

  // THE DATE IS CHECKED EVEN WHEN THERE IS ONLY ONE CANDIDATE.
  //
  // This branch used to return early on `sameAircraft.length === 1`,
  // before the window was ever consulted — which made the date window
  // effectively infinite in the single-trip case, and the single-trip case
  // is the COMMON one: a contract pilot usually has one logged trip per
  // tail, not two. A March trip in N447SP would take an August receipt for
  // the same aircraft, auto-select the trip, and — through the client's
  // default treatment — flip it to "rebill". Two money decisions from a
  // receipt five months out of period, disclosed by one line of grey text.
  const day = receipt.date;
  const overlapping = sameAircraft.filter((trip) =>
    within(day, shifted(trip.startsOn, -EDGE_DAYS), shifted(trip.endsOn, EDGE_DAYS))
  );

  if (overlapping.length === 1) {
    return {
      kind: "one",
      trip: overlapping[0]!,
      because: `${shown} on ${day}: that's this trip.`,
    };
  }
  if (overlapping.length === 0) {
    return {
      kind: "several",
      trips: sameAircraft,
      because:
        sameAircraft.length === 1
          ? `You flew ${shown}, but not on ${day}; this receipt doesn't fall in that trip, so pick one yourself.`
          : `You flew ${shown}, but not on ${day}: pick the trip this belongs to.`,
    };
  }
  return {
    kind: "several",
    trips: overlapping,
    because: `${overlapping.length} trips flew ${shown} around ${day}: pick the right one.`,
  };
}
