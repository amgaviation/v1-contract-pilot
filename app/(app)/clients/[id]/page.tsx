import NextLink from "next/link";
import { notFound } from "next/navigation";
import { LAlert, LCard, LRow, LRows, lButtonClass } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDate, formatDateRange } from "@/lib/format";
import { COUNTERPARTY_COPY, isInvoicedCounterparty } from "@/lib/counterparty";
import type { Database } from "@/lib/supabase/database.types";
import ClientForm from "../client-form";
import { updateClientRecord } from "../actions";
import ArchiveButton from "./archive-button";
import RateOverridesPanel from "./rate-overrides-panel";
import OperatorQualificationsPanel from "./operator-qualifications-panel";
import PacketPanel from "./packet-panel";
import VendorPanel, { type ExistingVendorLink } from "./vendor-panel";
import PaymentInsightPanel from "./payment-insight-panel";
import CostPanel from "./cost-panel";

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
  const { account, role } = await requireAccount(`/clients/${id}`);

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

  // 20260815120000. Decides the subtitle, the note below it, and whether
  // the Statement button is offered at all. Read through the shared helper
  // rather than `client.you_invoice === true` so an unselected or
  // pre-migration column reads as "yes, you bill them" in exactly one
  // place; see lib/counterparty.ts.
  const invoiced = isInvoicedCounterparty(client);

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
    vendorLinkResult,
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
    // The vendor page's own live link, for VendorPanel — same single-row
    // shape as the packet share right above (unique account_id, client_id).
    supabase
      .from("client_vendor_links")
      .select("token, expires_at, revoked_at, first_viewed_at, last_viewed_at")
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

  // Same U4 shape as the packet share above, on the row right next to it.
  const vendorLinkRow = vendorLinkResult.data as {
    token: string;
    expires_at: string;
    revoked_at: string | null;
    first_viewed_at: string | null;
    last_viewed_at: string | null;
  } | null;
  const vendorLinkLoadError = Boolean(vendorLinkResult.error);
  const liveVendorLink: ExistingVendorLink | null =
    vendorLinkRow && !vendorLinkRow.revoked_at && vendorLinkRow.expires_at > new Date().toISOString()
      ? {
          token: vendorLinkRow.token,
          expiresAt: formatDate(vendorLinkRow.expires_at.slice(0, 10)),
          firstViewedAt: vendorLinkRow.first_viewed_at,
          lastViewedAt: vendorLinkRow.last_viewed_at,
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
    <LPageShell
      title={client.name}
      subtitle={
        client.archived_at
          ? "Archived"
          : invoiced
            ? "Client"
            : "Operator you don't invoice"
      }
      action={
        <>
          {/* The statement: what this client was invoiced over a period,
              what they've paid, and what's outstanding — the document a
              pilot sends an owner or flight department whose AP pays in
              batches. Lives at its own route so it gets a period picker
              and a print view without crowding this screen.

              HIDDEN for a counterparty the pilot does not invoice
              (20260815120000). Not a cosmetic choice: that flag can only
              be set on a client with no invoices, no estimates and no
              schedule, so the statement behind this button is guaranteed
              empty. Offering it would be offering a blank document. */}
          {invoiced ? (
            <NextLink href={`/clients/${client.id}/statement`} className={lButtonClass({ variant: "outline" })}>
              Statement
            </NextLink>
          ) : null}
          <ArchiveButton id={client.id} archived={Boolean(client.archived_at)} />
        </>
      }
    >
      {client.archived_at ? (
        <LCard>
          <p className="text-body-s text-ink-2">
            This client is archived. Their trips and invoices are
            untouched. They just won&rsquo;t appear when you pick a client
            for new work.
          </p>
        </LCard>
      ) : null}

      {invoiced ? null : (
        <LCard>
          <p className="text-body-s text-ink-2">{COUNTERPARTY_COPY.pageNote}</p>
        </LCard>
      )}

      <ClientForm
        action={updateClientRecord}
        values={client}
        submitLabel="Save changes"
      />

      {/* H8b: "what does this client owe me" — unbilled trips (work not
          yet invoiced) and outstanding invoices (already billed, not yet
          paid), each linking straight to its own record. */}
      {linkedRecordsError ? (
        <LCard>
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>Couldn&rsquo;t load this client&rsquo;s trips and invoices.</span>
          </LAlert>
        </LCard>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <LCard>
            <div className="mb-1 text-h3 font-semibold">Unbilled trips</div>
            <p className="mb-3 text-body-s text-ink-3">Flown or scheduled, not yet invoiced.</p>
            {openTrips.length === 0 ? (
              <p className="text-body-s text-ink-3">None right now.</p>
            ) : (
              <LRows>
                {openTrips.map((trip) => (
                  <LRow key={trip.id}>
                    <NextLink href={`/trips/${trip.id}`} className="font-medium text-accent hover:underline">
                      {formatDateRange(trip.starts_on, trip.ends_on)}
                      {trip.aircraft_ident ? ` · ${trip.aircraft_ident}` : ""}
                    </NextLink>
                  </LRow>
                ))}
                {openTripsTruncated ? (
                  <LRow>
                    <NextLink
                      href={`/trips?client=${id}&billing_state=unbilled`}
                      className="text-caption text-accent hover:underline"
                    >
                      Showing the {OPEN_TRIPS_LIMIT} most recent, view all
                    </NextLink>
                  </LRow>
                ) : null}
              </LRows>
            )}
          </LCard>

          <LCard>
            <div className="mb-1 text-h3 font-semibold">Outstanding invoices</div>
            <p className="mb-3 text-body-s text-ink-3">Sent, awaiting payment.</p>
            {outstandingInvoices.length === 0 ? (
              <p className="text-body-s text-ink-3">None right now.</p>
            ) : (
              <LRows>
                {outstandingInvoices.map((invoice) => (
                  <LRow key={invoice.id}>
                    <NextLink
                      href={`/invoices/${invoice.id}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {invoice.invoice_number ?? "Invoice"}
                    </NextLink>
                    <span className="tnum-l text-body-s text-ink-2">
                      {formatCents(balanceByInvoice.get(invoice.id) ?? 0)}
                    </span>
                  </LRow>
                ))}
                {outstandingInvoicesTruncated ? (
                  <LRow>
                    <span className="text-caption text-ink-3">
                      Showing the {OUTSTANDING_INVOICES_LIMIT} soonest due. More are
                      outstanding.
                    </span>
                  </LRow>
                ) : null}
              </LRows>
            )}
          </LCard>
        </div>
      )}

      {/* Payment behavior — this client's own receivables history (median
          days-to-pay, aging, outstanding), from this account's ledger
          only. A self-contained server component with its own reads; see
          payment-insight.ts for the computation and the no-cross-tenant
          rule. */}
      {/* What this client has cost, counting both the expenses filed
          against their trips and the ones attributed to them directly
          (20260815130000). Sits next to "what do they owe me" because it
          is the other half of the same question. */}
      <CostPanel
        clientId={client.id}
        clientName={client.name}
        archived={Boolean(client.archived_at)}
      />

      <PaymentInsightPanel accountId={account.id} clientId={client.id} />

      {/* F5: cancellation_policy_note had nowhere it would ever actually
          be seen — the invoice draft only surfaces it when a CANCELED
          trip is selected, and the trip picker only offers COMPLETED
          trips, so the note was write-only. Placed next to the rate
          overrides, the other per-client terms the product records but
          doesn't act on by itself, and labeled the same way. */}
      {client.cancellation_policy_note ? (
        <LCard>
          <p className="text-body-s text-ink-2">
            <span className="font-bold text-ink">Cancellation terms on file:</span>{" "}
            {client.cancellation_policy_note}
          </p>
          <p className="mt-1 text-caption text-ink-3">
            Recorded for reference only, never applied automatically.
            Add a cancellation fee line on the invoice yourself if this
            client owes one.
          </p>
        </LCard>
      ) : null}

      {ratesLoadError ? (
        <LCard>
          <LAlert tone="crit">
            Couldn&rsquo;t load rate overrides. Try reloading the page.
          </LAlert>
        </LCard>
      ) : (
        <RateOverridesPanel
          clientId={client.id}
          dayTypes={dayTypes}
          overrides={rateOverrides}
        />
      )}

      <PacketPanel
        clientId={client.id}
        clientName={client.name}
        documents={packetDocuments}
        documentsLoadError={packetDocumentsLoadError}
        existing={livePacket}
        existingLoadError={packetShareLoadError}
      />

      {/* Mounted with 20260817160000's autopay work — the panel existed
          before that but was never rendered anywhere, so the whole vendor
          page feature (20260814112000) had no way to mint a link. */}
      <VendorPanel
        clientId={client.id}
        clientName={client.name}
        existing={liveVendorLink}
        existingLoadError={vendorLinkLoadError}
        autopay={{
          methodLabel: client.autopay_method_label,
          consentedOn: client.autopay_consented_at
            ? formatDate(client.autopay_consented_at.slice(0, 10))
            : null,
        }}
        canDisableAutopay={role === "owner"}
      />

      <OperatorQualificationsPanel
        clientId={client.id}
        clientName={client.name}
        clientOperatingRule={client.operating_rule}
        qualifications={qualifications}
        loadError={qualificationsLoadError}
      />
    </LPageShell>
  );
}

/* ── Inline icon ───────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. Same shape as invoices/[id]/page.tsx's own WarningIcon. */
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
