import NextLink from "next/link";
import { LAlert, LCard, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDateRange } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { rowsOf } from "@/lib/supabase/rows";
import type { Database } from "@/lib/supabase/database.types";
import { computeYearTotals } from "@/lib/mileage";
import MileageForm, { type ClientOption, type RatesByYear, type TripOption } from "./mileage-form";

export const metadata = { title: "Mileage" };

type MileageEntryRow = Database["pilot"]["Tables"]["mileage_entries"]["Row"];

type TripRow = {
  id: string;
  starts_on: string;
  ends_on: string;
  aircraft_ident: string | null;
};

type ClientRow = { id: string; name: string };
type RateRow = { tax_year: number; rate_cents_per_mile: number };

// Same truncation-visibility discipline as expenses/page.tsx's
// EXPENSES_LIMIT: Supabase's Data API silently truncates a plain select at
// its row cap, so an explicit .limit() makes the boundary something the
// screen can detect (rows.length === the limit) instead of a quietly
// short total.
const ENTRIES_LIMIT = 1000;

// computeYearTotals moved to lib/mileage.ts so /reports/profit-loss can
// use the SAME arithmetic. It used to live here, which is exactly why the
// report that goes to a pilot's accountant carried a different figure from
// this screen for the same drives — see that file's header.
export type { YearTotal, RatesByYear } from "@/lib/mileage";

export default async function MileagePage() {
  await requireAccount("/expenses/mileage");

  const supabase = await createClient();
  const [
    { data: entryData, error },
    { data: tripData, error: tripsError },
    { data: clientData, error: clientsError },
    ratesResult,
  ] = await Promise.all([
    supabase
      .from("mileage_entries")
      .select("*")
      .order("drove_on", { ascending: false })
      .limit(ENTRIES_LIMIT),
    supabase
      .from("trips")
      .select("id, starts_on, ends_on, aircraft_ident")
      .order("starts_on", { ascending: false }),
    supabase.from("clients").select("id, name"),
    supabase.from("mileage_rates").select("tax_year, rate_cents_per_mile"),
  ]);

  const entries = (entryData ?? []) as MileageEntryRow[];
  const trips = (tripData ?? []) as TripRow[];
  const clients = (clientData ?? []) as ClientRow[];
  const truncated = entries.length === ENTRIES_LIMIT;
  // S1: same shape as U2, on a different screen for the same money — this
  // read used to destructure `{ data: rateData }` only. On failure
  // `ratesByYear` built from `[]` is indistinguishable from a pilot who
  // genuinely has no rate on file, and this page used to say exactly that
  // ("You haven't recorded a mileage rate yet") and print "No rate on
  // file" for every year below, discarding a real Schedule C deduction
  // the pilot already recorded.
  const rates = rowsOf<RateRow>(ratesResult);
  const mileageRatesFailed = !rates.ok;
  const ratesByYear: RatesByYear = mileageRatesFailed
    ? {}
    : Object.fromEntries(rates.rows.map((r) => [r.tax_year, r.rate_cents_per_mile]));
  // Advisory only — a failed trips/clients read degrades the log form's
  // pickers to empty rather than asserting a wrong dollar figure, so it
  // doesn't get the same "must not compute" treatment as the rate read.
  const tripsOrClientsFailed = Boolean(tripsError || clientsError);

  const tripOptions: TripOption[] = trips.map((trip) => ({
    id: trip.id,
    label: `${formatDateRange(trip.starts_on, trip.ends_on)}${
      trip.aircraft_ident ? ` · ${trip.aircraft_ident}` : ""
    }`,
  }));
  const clientOptions: ClientOption[] = clients.map((c) => ({ id: c.id, name: c.name }));

  // DEFECT 5 FIX (20260809050000): the old headline summed each row's own
  // amount_cents (already round(miles * rate) PER ROW) and called the
  // result "at the standard mileage rate", singular. Two live bugs in
  // that: (1) summing rounded rows != rounding the summed product —
  // Schedule C wants total business miles x the year's rate, rounded
  // ONCE, not N row-roundings added together (reviewer executed 250
  // entries of 12.5mi @ 65.000: sum(amount_cents)=203250 vs the correct
  // round(sum(miles)*65)=203125, a $1.25 systematic overstatement that
  // scales with entry count); (2) it blended every tax year's entries
  // into one figure and called it "the" rate, which is false the moment
  // two different years (two different rates) are both loaded. Fixed by
  // grouping by tax year and computing each year's Schedule C figure from
  // that year's OWN rate on file (mileage_rates, not each row's
  // snapshotted rate_cents_per_mile — a row's snapshot can differ from
  // the year's current rate if it predates the rate being entered, or
  // was typed by hand, and the headline should reflect one authoritative
  // per-year rate, not whatever assortment of snapshots happen to exist).
  const totalMiles = entries.reduce((sum, e) => sum + e.miles, 0);
  const yearTotals = computeYearTotals(entries, ratesByYear);

  return (
    <LPageShell
      title="Mileage"
      subtitle={
        error
          ? "Couldn't load your mileage log."
          : // A record of what was entered, not a determination, matches
            // the register of CURRENCY_DISCLAIMER (lib/brand.ts) and the
            // quarterly report's "planning aid" callout
            // (reports/quarterly/page.tsx). No single blended rate is
            // asserted here; the by-tax-year breakdown below is where any
            // dollar figure actually appears.
            `${totalMiles.toFixed(1)} mi logged across ${entries.length} drive${entries.length === 1 ? "" : "s"}`
      }
      action={
        <NextLink href="/expenses" className={lButtonClass({ variant: "outline" })}>
          Back to expenses
        </NextLink>
      }
    >
      {error ? (
        <LCard>
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>{friendlyDbError(error, "mileage_entries.select")}</span>
          </LAlert>
        </LCard>
      ) : (
        <>
          {truncated ? (
            <LAlert tone="warn" className="flex items-start gap-2">
              <WarningIcon className="mt-0.5 shrink-0 text-warn" />
              <span>
                {`Totals above may be partial. There are more than ${ENTRIES_LIMIT} drives logged and only the first ${ENTRIES_LIMIT} were totaled.`}
              </span>
            </LAlert>
          ) : null}
          {/* S1: same shape as U2 — see the ratesByYear comment above. A
              failed mileage_rates read must not render as "no rate on
              file"; every cell below that would otherwise print that
              phrase prints "Couldn't load" instead, and the day-one hint
              beneath the form is suppressed in favour of this callout. */}
          {mileageRatesFailed ? (
            <LAlert tone="crit" className="flex items-start gap-2">
              <WarningIcon className="mt-0.5 shrink-0 text-crit" />
              <span>
                Couldn&rsquo;t load your mileage rates. This is not a
                statement that none are on file. The figures below are
                withheld rather than shown as $0 or &ldquo;no rate&rdquo;.
                Reload to try again.
              </span>
            </LAlert>
          ) : null}
          {yearTotals.length > 0 ? (
            <LCard>
              <p className="mb-2 text-lead font-bold">By tax year</p>
              <LTable>
                <thead>
                  <tr>
                    <LTh>Tax year</LTh>
                    <LTh numeric>Miles</LTh>
                    <LTh numeric>Rate</LTh>
                    <LTh numeric>Standard mileage figure</LTh>
                  </tr>
                </thead>
                <tbody>
                  {yearTotals.map((yt) => (
                    <tr key={yt.year}>
                      <th
                        scope="row"
                        className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                      >
                        {yt.year}
                      </th>
                      <LTd numeric>{yt.miles.toFixed(1)}</LTd>
                      <LTd numeric>
                        <span className="text-ink-2">
                          {mileageRatesFailed
                            ? "Couldn't load"
                            : yt.rateCentsPerMile === null
                              ? "—"
                              : `${yt.rateCentsPerMile}¢/mi`}
                        </span>
                      </LTd>
                      <LTd numeric>
                        <span className="font-medium">
                          {mileageRatesFailed
                            ? "Couldn't load"
                            : yt.amountCents === null
                              ? "No rate on file"
                              : formatCents(yt.amountCents)}
                        </span>
                      </LTd>
                    </tr>
                  ))}
                </tbody>
              </LTable>
              <p className="mt-2 text-caption text-ink-3">
                {"Each year's figure is that year's own rate on file times that year's total miles, "}
                {"rounded once, not a sum of individually rounded rows. This is a record computed "}
                {"from what you entered, not a tax determination."}
              </p>
            </LCard>
          ) : null}
          {/* S1, advisory half: a failed trips/clients read only empties
              this form's pickers — it never asserts a wrong dollar figure
              the way the rate read above does, so it gets a note rather
              than withholding the whole form. */}
          {tripsOrClientsFailed ? (
            <LAlert tone="warn" className="flex items-start gap-2">
              <WarningIcon className="mt-0.5 shrink-0 text-warn" />
              <span>
                Couldn&rsquo;t load your trips or clients, so those
                pickers below are empty. Drives can still be logged;
                reload before assigning one to a trip or client.
              </span>
            </LAlert>
          ) : null}
          <MileageForm
            entries={entries}
            trips={tripOptions}
            clients={clientOptions}
            rates={ratesByYear}
          />
          {!mileageRatesFailed && Object.keys(ratesByYear).length === 0 ? (
            <LCard>
              <p className="text-body-s text-ink-2">
                {"You haven't recorded a mileage rate yet. Add one under "}
                <NextLink href="/settings?tab=mileage" className="text-accent underline-offset-2 hover:underline">
                  Settings → Mileage
                </NextLink>
                {". Drives can still be logged with a rate typed in by hand."}
              </p>
            </LCard>
          ) : null}
        </>
      )}
    </LPageShell>
  );
}

/* ── Inline icon ───────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. */
function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 2 14.25 13H1.75Z" />
      <path d="M8 6.25v3" />
      <circle cx="8" cy="11.25" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
