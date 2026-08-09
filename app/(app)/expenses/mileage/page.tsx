import NextLink from "next/link";
import { Button, Callout, Card, Text } from "@/components/ui";
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

  const total = entries.reduce((sum, e) => sum + e.amount_cents, 0);
  const totalMiles = entries.reduce((sum, e) => sum + e.miles, 0);

  return (
    <PageShell
      title="Mileage"
      subtitle={
        error
          ? "Couldn't load your mileage log."
          : `${totalMiles.toFixed(1)} mi logged · ${formatCents(total)} at the standard mileage rate`
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
