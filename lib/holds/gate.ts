import "server-only";

/**
 * THE FLAG on the one scheduled job in this product that DELETES a
 * customer's records.
 *
 * Modelled on lib/currency/gate.ts, and for a stronger reason than that one
 * had. The currency engine ships dark because a wrong answer about legality
 * would mislead a pilot. This ships dark because a wrong WHERE clause
 * destroys commercial records across every tenant at once, unattended, at
 * 03:00, with nobody watching — and unlike every other destructive path in
 * this product there is no human in the loop confirming anything.
 *
 * Everything else in the hold feature works with this off: a pilot can place
 * a hold, Stripe stops collecting, the account goes read-only, and they can
 * resume. The ONLY thing the flag governs is whether the expiry pass is
 * allowed to purge. With it off the route still runs, still reports what it
 * WOULD have purged, and deletes nothing — so the pass can be watched in
 * production for as long as it takes to trust it, against real data, before
 * anything is destroyed.
 *
 * Same expression as the currency gate, for the same reasons documented at
 * length there: one literal, exact match, case-sensitive, after trim. An
 * unset var, an empty var, "TRUE", "1" and "yes" all read as OFF. The only
 * way to switch this on is to type the documented value exactly, which is
 * the appropriate amount of friction for arming an unattended delete.
 */
export const HOLD_PURGE_FLAG_ENV = "HOLD_EXPIRY_PURGE_ENABLED";

export function holdExpiryPurgeEnabled(): boolean {
  return process.env[HOLD_PURGE_FLAG_ENV]?.trim() === "true";
}

/**
 * A cap on how many accounts one pass may purge.
 *
 * Not a performance limit — a blast-radius limit. In steady state a handful
 * of holds expire on any given day; a pass that suddenly finds hundreds due
 * has almost certainly been handed a bad query or a clock problem rather
 * than a genuine cohort, and the right response to "this looks wrong" is to
 * stop and be noticed, not to work through the list. The pass reports the
 * overflow loudly and purges nothing beyond the cap.
 */
export const HOLD_EXPIRY_MAX_PER_RUN = 25;
