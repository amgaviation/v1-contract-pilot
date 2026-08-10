import NextLink from "next/link";
import { notFound } from "next/navigation";
import {
  Box,
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
  await requireAccount(`/clients/${id}`);

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
    // flight-status reading of "open".
    supabase
      .from("trips")
      .select("id, starts_on, ends_on, aircraft_ident, billing_state")
      .eq("client_id", id)
      .eq("billing_state", "unbilled")
      .order("starts_on", { ascending: false })
      .limit(OPEN_TRIPS_LIMIT),
    // "Outstanding" matches Overview's own "Awaiting payment" definition:
    // issued invoices that still owe something — draft owes nothing yet,
    // paid/void owe nothing anymore.
    supabase
      .from("invoices")
      .select("id, invoice_number, due_on, status")
      .eq("client_id", id)
      .in("status", ["sent", "partial"])
      .order("due_on", { ascending: true })
      .limit(OUTSTANDING_INVOICES_LIMIT),
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
  const packetShareRow = packetShareResult.data as {
    token: string;
    expires_at: string;
    revoked_at: string | null;
  } | null;
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

  const openTrips = (openTripsResult.data ?? []) as OpenTripRow[];
  const outstandingInvoices = (invoicesResult.data ?? []) as OutstandingInvoiceRow[];
  const linkedRecordsError = openTripsResult.error ?? invoicesResult.error;

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

  return (
    <PageShell
      title={client.name}
      subtitle={client.archived_at ? "Archived" : "Client"}
      action={<ArchiveButton id={client.id} archived={Boolean(client.archived_at)} />}
    >
      {client.archived_at ? (
        <Card mb="4">
          <Text size="2" color="gray">
            This client is archived. Their trips and invoices are
            untouched — they just won&rsquo;t appear when you pick a client
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
              </Flex>
            )}
          </Card>
        </Grid>
      )}

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
            Recorded for reference only — never applied automatically.
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
          existing={livePacket}
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
