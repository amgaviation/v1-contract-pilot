/**
 * The one place a mileage deduction is turned into money.
 *
 * WHY THIS IS A SHARED MODULE AND NOT A PAGE HELPER. It used to live in
 * app/(app)/expenses/mileage/page.tsx, where the mileage screen got the
 * arithmetic right and every other surface got it wrong: /reports/
 * profit-loss and /expenses both summed each row's own stored
 * amount_cents instead. Summing N rounded rows is not the same number as
 * rounding the summed product — 250 drives of 12.5 miles at 65.0 cents is
 * $2,032.50 per-row against $2,031.25 computed once, a systematic
 * OVERSTATEMENT that grows with the number of drives. The mileage screen
 * showed one figure and the report that goes to the accountant showed the
 * other, for the same drives.
 *
 * Schedule C wants total business miles for the year multiplied by that
 * year's rate. One multiplication, one rounding. So there is exactly one
 * function, and every surface calls it — the same reasoning that put
 * tripValueCents in its own module.
 *
 * Grouping is by TAX YEAR because the IRS rate changes annually; blending
 * two years' miles and applying one rate is wrong the moment a report
 * spans a year boundary. The year is read as the first four characters of
 * the "YYYY-MM-DD" drove_on string — never a Date parse, which would shift
 * the year for a date near midnight in a negative-offset timezone.
 *
 * Math.round matches Postgres's round()-with-no-scale-argument (round half
 * away from zero) for the non-negative inputs this domain always has
 * (miles > 0, rate >= 0, per their CHECK constraints), so the app and any
 * SQL-side equivalent cannot disagree.
 */

/** tax_year -> that year's rate in cents per mile, as the pilot entered it. */
export type RatesByYear = Record<number, number>;

export type YearTotal = {
  year: number;
  miles: number;
  rateCentsPerMile: number | null;
  /**
   * round(miles * rateCentsPerMile), computed ONCE over the year's summed
   * miles and never by summing per-row amounts. Null when no rate is on
   * file for that year — the miles are still shown, and no dollar figure
   * is invented from a rate nobody entered.
   */
  amountCents: number | null;
};

export function computeYearTotals(
  entries: readonly { drove_on: string; miles: number }[],
  ratesByYear: RatesByYear
): YearTotal[] {
  const milesByYear = new Map<number, number>();
  for (const entry of entries) {
    const year = Number(entry.drove_on.slice(0, 4));
    milesByYear.set(year, (milesByYear.get(year) ?? 0) + entry.miles);
  }
  return [...milesByYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, miles]) => {
      const rate = ratesByYear[year];
      const amountCents = rate === undefined ? null : Math.round(miles * rate);
      return { year, miles, rateCentsPerMile: rate ?? null, amountCents };
    });
}

/**
 * The Schedule C figure across every year in the set.
 *
 * Years with no rate on file contribute NOTHING rather than a guess, and
 * the caller is told how many miles were left out so it can say so — a
 * deduction silently missing a year's driving is worse than one that
 * admits the rate is missing.
 */
export function scheduleCMileageCents(
  entries: readonly { drove_on: string; miles: number }[],
  ratesByYear: RatesByYear
): { amountCents: number; milesWithoutRate: number } {
  let amountCents = 0;
  let milesWithoutRate = 0;
  for (const year of computeYearTotals(entries, ratesByYear)) {
    if (year.amountCents === null) milesWithoutRate += year.miles;
    else amountCents += year.amountCents;
  }
  return { amountCents, milesWithoutRate };
}
