import NextLink from "next/link";
import { notFound } from "next/navigation";
import {
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Link as RadixLink,
  Text,
} from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDate, formatDateRange } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";
import PageShell from "../../page-shell";
import ClientForm from "../client-form";
import { updateClientRecord } from "../actions";
import ArchiveButton from "./archive-button";
import RateOverridesPanel from "./rate-overrides-panel";
import OperatorQualificationsPanel from "./operator-qualifications-panel";
import PacketPanel from "./packet-panel";
import PaymentInsightPanel from "./payment-insight-panel";

type ClientRow = Database["pilot"]["Tables"]["clients"]["Row"];
type DayTypeRow = Database["pilot"]["Tables"]["day_types"]["Row"];
type ClientRateRow = Database["pilot"]["Tables"]["client_rates"]["Row"];
type OperatorQualificationRow = Database["pilot"]["Tables"]["operator_qualifications"]["Row"];

type OpenTripRow = {
  id: string;
  starts_on: string;
  ends_on: string;
  aircraft_ident: string | null;
  billing_state: string;
};

type OutstandingInvoiceRow = {
  id: string;
  invoice_number: string | null;
  due_on: string | null;
  status: "draft" | "sent" | "partial" | "paid" | "void";
};

type BalanceRow = {
  invoice_id: string;
  balance_due_cents: number;
};

// H8b: nothing on this page answered "what does this client owe me" —
// the data model wires a client to its trips and invoices, but the page
// was an island. These two lists are read directly here (rather than by
// linking to a filtered /trips or /invoices, which don't support a
// ?client= param and aren't this agent's files to add one to) so each row
// can link straight to its own record.
const OPEN_TRIPS_LIMIT = 10;
const OUTSTANDING_INVOICES_LIMIT = 10;

export const metadata = { title: "Edit client" };

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { account } = await requireAccount(`/clients/${id}`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  // A failed query is not a missing client — see the note in
  // trips/[id]/page.tsx.
  if (error) {
    throw new Error(`Couldn't load client ${id}: ${error.message}`);
  }

  const client = data as ClientRow | null;
  // Another tenant's id and a nonexistent id are indistinguishable here,
  // and that is the point: RLS returns no row either way, so a probe
  // can't tell "not yours" from "not real".
  if (!client) notFound();

  // F10: fetches EVERY day type, not just active ones. An archived type
  // is dropped from every picker (it's already removed from new trips'
  // day grids), but an override on one doesn't stop existing — filtering
  // the query itself made that override invisible while it still applied
  // to any not-yet-invoiced day already captured under the old type.
  // RateOverridesPanel is what decides active-vs-archived-with-override.
  const [
    dayTypesResult,
    ratesResult,
    openTripsResult,
    invoicesResult,
    qualificationsResult,
    packetDocsResult,
    packetShareResult,
  ] =
    await Promise.all([
    supabase
      .from("day_types")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("key", { ascending: true }),
    supabase.from("client_rates").select("*").eq("client_id", id),
    // "Open" as in not yet billed — the same billing_state='unbilled'
    // trips/page.tsx and Overview both use for "still owes work", not a
    // flight-status reading of "open". Status is allow-listed to exactly
    // what the caption promises ("Flown or scheduled, not yet invoiced"):
    // a canceled trip keeps billing_state='unbilled' forever (nothing ever
    // invoices it through the normal path) and a 'hold' (20260814094000)
    // is a tentative, unconfirmed block on the calendar, not scheduled
    // work — either one sitting in this list would look like open work the
    // caption explicitly excludes, and for a canceled trip it hides the
    // fact that it might still owe a cancellation fee, which belongs on
    // its own, honest surface rather than disguised as a live trip.
    // +1: the only way to know the cap was actually hit — see
    // tripsTruncated below, same pattern trips/page.tsx uses for its own
    // 1000-row cap.
    supabase
      .from("trips")
      .select("id, starts_on, ends_on, aircraft_ident, billing_state")
      .eq("client_id", id)
      .eq("billing_state", "unbilled")
      .in("status", ["scheduled", "in_progress", "completed"])
      .order("starts_on", { ascending: false })
      .limit(OPEN_TRIPS_LIMIT + 1),
    // "Outstanding" matches Overview's own "Awaiting payment" definition:
    // issued invoices that still owe something — draft owes nothing yet,
    // paid/void owe nothing anymore. +1 for the same truncation check.
    supabase
      .from("invoices")
      .select("id, invoice_number, due_on, status")
      .eq("client_id", id)
      .in("status", ["sent", "partial"])
      .order("due_on", { ascending: true })
      .limit(OUTSTANDING_INVOICES_LIMIT + 1),
    supabase.from("operator_qualifications").select("*").eq("client_id", id),
    // The packet: what this pilot could send, and whatever link is live.
    // Documents NOT already tied to another client — a per-client document
    // belongs to that client and is not part of a general packet.
    supabase
      .from("documents")
      .select("id, kind, label, expires_on, client_id")
      .or(`client_id.is.null,client_id.eq.${id}`)
      .order("kind"),
    supabase
      .from("document_shares")
      .select("token, expires_at, revoked_at")
      .eq("client_id", id)
      .maybeSingle(),
  ]);

  const packetDocuments = ((packetDocsResult.data ?? []) as {
    id: string;
    kind: string;
    label: string;
    expires_on: string | null;
  }[]).map((d) => ({
    id: d.id,
    kind: d.kind,
    label: d.label,
    expiresOn: d.expires_on,
  }));
  // U4: packetDocsResult.error used to be discarded entirely. On failure
  // `packetDocuments` degrades to `[]` exactly like "this client really has
  // no documents yet" — PacketPanel would tell a pilot with a W-9,
  // certificate of insurance and day-rate agreement all on file "Nothing
  // to send yet" and hide the create-link form, because the READ failed,
  // not because the documents don't exist.
  const packetDocumentsLoadError = Boolean(packetDocsResult.error);
  const packetShareRow = packetShareResult.data as {
    token: string;
    expires_at: string;
    revoked_at: string | null;
  } | null;
  // Same U4 shape as packetDocumentsLoadError above, on the read right next
  // to it: packetShareResult.error used to be discarded entirely, so a
  // failed lookup degraded packetShareRow (and therefore livePacket) to
  // null exactly like "no live packet exists" would — hiding PacketPanel's
  // live-link block from a pilot whose credential packet IS out with this
  // client, and risking a second one being created on top of it.
  const packetShareLoadError = Boolean(packetShareResult.error);
  // A revoked or expired row still exists; neither is a live link, and
  // showing one would offer the pilot a URL that 404s for their client.
  const livePacket =
    packetShareRow && !packetShareRow.revoked_at && packetShareRow.expires_at > new Date().toISOString()
      ? {
          token: packetShareRow.token,
          expiresAt: formatDate(packetShareRow.expires_at.slice(0, 10)),
          documentCount: 0,
        }
      : null;

  const dayTypes = (dayTypesResult.data ?? []) as DayTypeRow[];
  const rateOverrides = (ratesResult.data ?? []) as ClientRateRow[];
  const ratesLoadError = dayTypesResult.error ?? ratesResult.error;

  const openTripsAll = (openTripsResult.data ?? []) as OpenTripRow[];
  const openTrips = openTripsAll.slice(0, OPEN_TRIPS_LIMIT);
  // A client with more open trips than the cap used to show exactly 10
  // with nothing on screen admitting it — on the one screen whose stated
  // job is "what does this client owe me". Every other capped list in
  // this codebase (trips/page.tsx's 1000-trip cap included) detects and
  // says so; this now does too.
  const openTripsTruncated = openTripsAll.length > OPEN_TRIPS_LIMIT;

  const outstandingInvoicesAll = (invoicesResult.data ?? []) as OutstandingInvoiceRow[];
  const outstandingInvoices = outstandingInvoicesAll.slice(0, OUTSTANDING_INVOICES_LIMIT);
  const outstandingInvoicesTruncated =
    outstandingInvoicesAll.length > OUTSTANDING_INVOICES_LIMIT;

  const qualifications = (qualificationsResult.data ?? []) as OperatorQualificationRow[];
  const qualificationsLoadError = Boolean(qualificationsResult.error);

  const invoiceIds = outstandingInvoices.map((inv) => inv.id);
  const balancesResult = invoiceIds.length
    ? await supabase
        .from("invoice_totals")
        .select("invoice_id, balance_due_cents")
        .in("invoice_id", invoiceIds)
    : { data: [] as BalanceRow[], error: null };
  const balanceByInvoice = new Map(
    ((balancesResult.data ?? []) as BalanceRow[]).map((b) => [b.invoice_id, b.balance_due_cents])
  );
  // A failed invoice_totals read is not "nothing owed" — without this, an
  // invoice_totals error left balanceByInvoice empty and every row printed
  // formatCents(undefined ?? 0), "$0.00" in the gray styling reserved for
  // settled, on the one screen a pilot opens to ask what a client owes.
  const linkedRecordsError = openTripsResult.error ?? invoicesResult.error ?? balancesResult.error;

  return (
    <PageShell
      title={client.name}
      subtitle={client.archived_at ? "Archived" : "Client"}
      action={
        <>
          {/* The statement: what this client was invoiced over a period,
              what they've paid, and what's outstanding — the document a
              pilot sends an owner or flight department whose AP pays in
              batches. Lives at its own route so it gets a period picker
              and a print view without crowding this screen. */}
          <Button asChild variant="soft">
            <NextLink href={`/clients/${client.id}/statement`}>
              Statement
            </NextLink>
          </Button>
          <ArchiveButton id={client.id} archived={Boolean(client.archived_at)} />
        </>
      }
    >
      {client.archived_at ? (
        <Card mb="4">
          <Text size="2" color="gray">
            This client is archived. Their trips and invoices are
            untouched. They just won&rsquo;t appear when you pick a client
            for new work.
          </Text>
        </Card>
      ) : null}

      <ClientForm
        action={updateClientRecord}
        values={client}
        submitLabel="Save changes"
      />

      {/* H8b: "what does this client owe me" — unbilled trips (work not
          yet invoiced) and outstanding invoices (already billed, not yet
          paid), each linking straight to its own record. */}
      {linkedRecordsError ? (
        <Card mt="4">
          <Callout.Root color="red">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>
              Couldn&rsquo;t load this client&rsquo;s trips and invoices.
            </Callout.Text>
          </Callout.Root>
        </Card>
      ) : (
        <Grid columns={{ initial: "1", md: "2" }} gap="4" mt="4">
          <Card>
            <Text as="div" size="4" weight="bold" mb="1">
              Unbilled trips
            </Text>
            <Text as="div" size="2" color="gray" mb="3">
              Flown or scheduled, not yet invoiced.
            </Text>
            {openTrips.length === 0 ? (
              <Text size="2" color="gray">
                None right now.
              </Text>
            ) : (
              <Flex direction="column" gap="2">
                {openTrips.map((trip) => (
                  <Flex key={trip.id} justify="between" align="center">
                    <RadixLink asChild weight="medium">
                      <NextLink href={`/trips/${trip.id}`}>
                        {formatDateRange(trip.starts_on, trip.ends_on)}
                        {trip.aircraft_ident ? ` · ${trip.aircraft_ident}` : ""}
                      </NextLink>
                    </RadixLink>
                  </Flex>
                ))}
                {openTripsTruncated ? (
                  <RadixLink asChild size="1">
                    <NextLink href={`/trips?client=${id}&billing_state=unbilled`}>
                      Showing the {OPEN_TRIPS_LIMIT} most recent, view all
                    </NextLink>
                  </RadixLink>
                ) : null}
              </Flex>
            )}
          </Card>

          <Card>
            <Text as="div" size="4" weight="bold" mb="1">
              Outstanding invoices
            </Text>
            <Text as="div" size="2" color="gray" mb="3">
              Sent, awaiting payment.
            </Text>
            {outstandingInvoices.length === 0 ? (
              <Text size="2" color="gray">
                None right now.
              </Text>
            ) : (
              <Flex direction="column" gap="2">
                {outstandingInvoices.map((invoice) => (
                  <Flex key={invoice.id} justify="between" align="center">
                    <RadixLink asChild weight="medium">
                      <NextLink href={`/invoices/${invoice.id}`}>
                        {invoice.invoice_number ?? "Invoice"}
                      </NextLink>
                    </RadixLink>
                    <Text size="2" color="gray" className="tnum">
                      {formatCents(balanceByInvoice.get(invoice.id) ?? 0)}
                    </Text>
                  </Flex>
                ))}
                {outstandingInvoicesTruncated ? (
                  <Text size="1" color="gray">
                    Showing the {OUTSTANDING_INVOICES_LIMIT} soonest due. More are
                    outstanding.
                  </Text>
                ) : null}
              </Flex>
            )}
          </Card>
        </Grid>
      )}

      {/* Payment behavior — this client's own receivables history (median
          days-to-pay, aging, outstanding), from this account's ledger
          only. A self-contained server component with its own reads; see
          payment-insight.ts for the computation and the no-cross-tenant
          rule. */}
      <Box mt="4">
        <PaymentInsightPanel accountId={account.id} clientId={client.id} />
      </Box>

      {/* F5: cancellation_policy_note had nowhere it would ever actually
          be seen — the invoice draft only surfaces it when a CANCELED
          trip is selected, and the trip picker only offers COMPLETED
          trips, so the note was write-only. Placed next to the rate
          overrides, the other per-client terms the product records but
          doesn't act on by itself, and labeled the same way. */}
      {client.cancellation_policy_note ? (
        <Card mt="4">
          <Text size="2" color="gray">
            <Text as="span" size="2" weight="bold">
              Cancellation terms on file:
            </Text>{" "}
            {client.cancellation_policy_note}
          </Text>
          <Text as="p" size="1" color="gray" mt="1">
            Recorded for reference only, never applied automatically.
            Add a cancellation fee line on the invoice yourself if this
            client owes one.
          </Text>
        </Card>
      ) : null}

      {ratesLoadError ? (
        <Card mt="4">
          <Callout.Root color="red">
            <Callout.Text>
              Couldn&rsquo;t load rate overrides. Try reloading the page.
            </Callout.Text>
          </Callout.Root>
        </Card>
      ) : (
        <Box mt="4">
          <RateOverridesPanel
            clientId={client.id}
            dayTypes={dayTypes}
            overrides={rateOverrides}
          />
        </Box>
      )}

      <Box mt="4">
        <PacketPanel
          clientId={client.id}
          clientName={client.name}
          documents={packetDocuments}
          documentsLoadError={packetDocumentsLoadError}
          existing={livePacket}
          existingLoadError={packetShareLoadError}
        />
      </Box>

      <Box mt="4">
        <OperatorQualificationsPanel
          clientId={client.id}
          clientName={client.name}
          clientOperatingRule={client.operating_rule}
          qualifications={qualifications}
          loadError={qualificationsLoadError}
        />
      </Box>
    </PageShell>
  );
}
