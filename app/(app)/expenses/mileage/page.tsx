import NextLink from "next/link";
import { Button, Callout, Card, Table, Text } from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDateRange } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";
import PageShell from "../../page-shell";
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

export type YearTotal = {
  year: number;
  miles: number;
  rateCentsPerMile: number | null;
  /** round(miles * rateCentsPerMile) — computed ONCE over the year's
   * summed miles, never by summing per-row amounts. null when no rate is
   * on file for the year (miles are still shown; no dollar figure is
   * invented). */
  amountCents: number | null;
};

/**
 * Groups entries by tax year (extract(year from drove_on), i.e. the first
 * 4 characters of the "YYYY-MM-DD" drove_on string — never a Date parse,
 * to avoid a timezone-shifted year for a date near midnight) and computes
 * each year's Schedule-C figure from that year's rate on file — see the
 * "DEFECT 5 FIX" comment at the call site for the full reasoning. Math.round
 * matches Postgres's round()-with-no-scale-argument behavior (round half
 * away from zero) for the non-negative inputs this domain always has
 * (miles > 0, rate >= 0 per their CHECK constraints) — there is no
 * negative-number case here where the two would diverge.
 */
export function computeYearTotals(
  entries: Pick<MileageEntryRow, "drove_on" | "miles">[],
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

export default async function MileagePage() {
  await requireAccount("/expenses/mileage");

  const supabase = await createClient();
  const [
    { data: entryData, error },
    { data: tripData },
    { data: clientData },
    { data: rateData },
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
  const rates = (rateData ?? []) as RateRow[];
  const truncated = entries.length === ENTRIES_LIMIT;

  const tripOptions: TripOption[] = trips.map((trip) => ({
    id: trip.id,
    label: `${formatDateRange(trip.starts_on, trip.ends_on)}${
      trip.aircraft_ident ? ` · ${trip.aircraft_ident}` : ""
    }`,
  }));
  const clientOptions: ClientOption[] = clients.map((c) => ({ id: c.id, name: c.name }));
  const ratesByYear: RatesByYear = Object.fromEntries(
    rates.map((r) => [r.tax_year, r.rate_cents_per_mile])
  );

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
    <PageShell
      title="Mileage"
      subtitle={
        error
          ? "Couldn't load your mileage log."
          : // A record of what was entered, not a determination — matches
            // the register of CURRENCY_DISCLAIMER (lib/brand.ts) and the
            // quarterly report's "planning aid" callout
            // (reports/quarterly/page.tsx). No single blended rate is
            // asserted here; the by-tax-year breakdown below is where any
            // dollar figure actually appears.
            `${totalMiles.toFixed(1)} mi logged across ${entries.length} drive${entries.length === 1 ? "" : "s"}`
      }
      action={
        <Button asChild variant="outline">
          <NextLink href="/expenses">Back to expenses</NextLink>
        </Button>
      }
    >
      {error ? (
        <Card size="3">
          <Callout.Root color="red">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>{friendlyDbError(error, "mileage_entries.select")}</Callout.Text>
          </Callout.Root>
        </Card>
      ) : (
        <>
          {truncated ? (
            <Card size="3" mb="4">
              <Callout.Root color="amber">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  {`Totals above may be partial — there are more than ${ENTRIES_LIMIT} drives logged and only the first ${ENTRIES_LIMIT} were totaled.`}
                </Callout.Text>
              </Callout.Root>
            </Card>
          ) : null}
          {yearTotals.length > 0 ? (
            <Card size="3" mb="4">
              <Text as="div" size="3" weight="bold" mb="2">
                By tax year
              </Text>
              <Table.Root variant="ghost">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>Tax year</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Miles</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Rate</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">
                      Standard mileage figure
                    </Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {yearTotals.map((yt) => (
                    <Table.Row key={yt.year}>
                      <Table.RowHeaderCell>
                        <Text weight="medium">{yt.year}</Text>
                      </Table.RowHeaderCell>
                      <Table.Cell justify="end">
                        <Text className="tnum">{yt.miles.toFixed(1)}</Text>
                      </Table.Cell>
                      <Table.Cell justify="end">
                        <Text className="tnum" color="gray">
                          {yt.rateCentsPerMile === null
                            ? "—"
                            : `${yt.rateCentsPerMile}¢/mi`}
                        </Text>
                      </Table.Cell>
                      <Table.Cell justify="end">
                        <Text weight="medium" className="tnum">
                          {yt.amountCents === null ? "No rate on file" : formatCents(yt.amountCents)}
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
              <Text as="div" size="1" color="gray" mt="2">
                {"Each year's figure is that year's own rate on file times that year's total miles, "}
                {"rounded once — not a sum of individually rounded rows. This is a record computed "}
                {"from what you entered, not a tax determination."}
              </Text>
            </Card>
          ) : null}
          <MileageForm
            entries={entries}
            trips={tripOptions}
            clients={clientOptions}
            rates={ratesByYear}
          />
          {Object.keys(ratesByYear).length === 0 ? (
            <Card size="3" mt="4">
              <Text size="2" color="gray">
                {"You haven't recorded a mileage rate yet. Add one under "}
                <NextLink href="/settings?tab=mileage">Settings → Mileage</NextLink>
                {" — drives can still be logged with a rate typed in by hand."}
              </Text>
            </Card>
          ) : null}
        </>
      )}
    </PageShell>
  );
}
