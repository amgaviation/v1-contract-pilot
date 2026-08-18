import NextLink from "next/link";
import { notFound } from "next/navigation";
import { LAlert, LCard, LPill, LSeparator } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";

import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { formatCents, formatDate } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { YOU_INVOICE_COLUMN } from "@/lib/counterparty";
import {
  ESTIMATE_STATUS_BADGE,
  ESTIMATE_STATUS_FALLBACK,
  type EstimateBadge,
  type EstimateStatus,
} from "../estimate-lib";
import HeaderForm, { type ClientOption } from "./header-form";
import LinesEditor, { type EstimateLineRow } from "./lines-editor";
import StatusActions from "./status-actions";

export const metadata = { title: "Estimate" };

type EstimateRow = {
  id: string;
  client_id: string;
  trip_id: string | null;
  estimate_number: string | null;
  status: EstimateStatus;
  issued_on: string | null;
  valid_until: string | null;
  sent_at: string | null;
  tax_rate_bps: number;
  terms: string | null;
  notes: string | null;
  converted_invoice_id: string | null;
  converted_at: string | null;
};

type TotalsRow = {
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
};

// The status/badge vocabulary is shared with the list screen (../page.tsx),
// which carries the identical mapping under the identical comment —
// duplicated rather than imported, same posture estimate-lib.ts's own
// header documents for cross-agent-surface helpers this session. A
// straight, restrained dictionary, the same one Overview's ladder uses:
// red→crit, amber→warn, green→good, gray→neutral, blue→accent.
function estimateBadgeTone(
  color: EstimateBadge["color"]
): "crit" | "warn" | "good" | "neutral" | "accent" {
  switch (color) {
    case "red":
      return "crit";
    case "amber":
      return "warn";
    case "green":
      return "good";
    case "blue":
      return "accent";
    default:
      return "neutral";
  }
}

export default async function EstimatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ warning?: string }>;
}) {
  const { id } = await params;
  const { warning } = await searchParams;
  await requireEntitlement("estimates", `/estimates/${id}`);

  const supabase = await createClient();

  const [
    { data: estimateData, error: estimateError },
    { data: lineData, error: lineError },
    { data: totalsData, error: totalsError },
    { data: expiredData, error: expiredError },
    { data: clientData, error: clientError },
  ] = await Promise.all([
    supabase.from("estimates").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("estimate_lines")
      .select("*")
      .eq("estimate_id", id)
      // (sort_order, id): sort_order alone is not a total order — lines
      // appended before addEstimateLine assigned max+1 all tie at the
      // column's default 0, and Postgres may return a tie in a different
      // order on different reads. The id tiebreak pins those legacy ties.
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
    supabase.from("estimate_totals").select("*").eq("estimate_id", id).maybeSingle(),
    // Derived expiry — the view is the one source for it, same as
    // invoices_overdue on the invoice screen.
    supabase
      .from("estimates_expired")
      .select("estimate_id, days_expired")
      .eq("estimate_id", id),
    // Not filtered to active-only: a sent estimate may quote a client that
    // has since been archived, and the picker still needs to show it.
    // 20260815120000: the header form re-points a DRAFT estimate at a
    // client, so it offers only counterparties the pilot bills. A draft
    // cannot lose its own current selection this way: an estimate is one
    // of the three things pilot.clients_refuse_stop_invoicing() refuses
    // to let a client carry while being marked as one you do not invoice.
    supabase
      .from("clients")
      .select("id, name")
      .eq(YOU_INVOICE_COLUMN, true)
      .order("name", { ascending: true }),
  ]);

  // A failed QUERY is not a missing estimate — a 503 must not read as
  // "you lost a quote" (same reasoning as trips/[id] and invoices/[id]).
  if (estimateError) {
    throw new Error(`Couldn't load estimate ${id}: ${estimateError.message}`);
  }
  if (lineError) {
    throw new Error(`Couldn't load estimate ${id}'s lines: ${lineError.message}`);
  }

  const estimate = estimateData as EstimateRow | null;
  // Another tenant's id and a nonexistent one both return no row under
  // RLS, so a probe can't tell them apart.
  if (!estimate) notFound();

  const lines = (lineData ?? []) as EstimateLineRow[];
  const totals = totalsData as TotalsRow | null;
  const expiredRow = ((expiredData ?? []) as { estimate_id: string; days_expired: number }[])[0];
  const clients = (clientData ?? []) as ClientOption[];

  // A failed totals/expired/clients read is not "no data" — a sent quote
  // must not render as a healthy $0.00 because a view read failed.
  const moneyError = totalsError ?? expiredError ?? clientError;

  const draft = estimate.status === "draft";
  const converted = estimate.converted_invoice_id !== null;

  // Only for the "this became an invoice" banner; best-effort, because a
  // failed read here degrades the link's label, never a dollar figure.
  let convertedInvoiceNumber: string | null = null;
  if (converted) {
    const { data: invoiceRow } = await supabase
      .from("invoices")
      .select("invoice_number")
      .eq("id", estimate.converted_invoice_id as string)
      .maybeSingle();
    convertedInvoiceNumber =
      (invoiceRow as { invoice_number: string | null } | null)?.invoice_number ?? null;
  }

  const badge = ESTIMATE_STATUS_BADGE[estimate.status] ?? ESTIMATE_STATUS_FALLBACK;
  const expired = Boolean(expiredRow);

  return (
    <LPageShell
      title={estimate.estimate_number ?? "Draft estimate"}
      subtitle={
        <div className="flex flex-wrap items-center gap-2">
          {expired ? (
            <LPill tone="warn">Expired</LPill>
          ) : (
            <LPill tone={estimateBadgeTone(badge.color)}>{badge.label}</LPill>
          )}
          <span className={expired ? "text-warn" : "text-ink-3"}>
            {estimate.issued_on ? `Sent ${formatDate(estimate.issued_on)}` : "Not yet sent"}
            {estimate.valid_until
              ? ` · Valid until ${formatDate(estimate.valid_until)}${expired ? " (passed)" : ""}`
              : ""}
          </span>
        </div>
      }
    >
      {warning ? (
        <LAlert tone="warn" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-warn" />
          <span>{warning}</span>
        </LAlert>
      ) : null}

      {moneyError ? (
        <LAlert tone="crit" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-crit" />
          <span>{friendlyDbError(moneyError, "estimates.detail")}</span>
        </LAlert>
      ) : null}

      {converted ? (
        <LAlert tone="good">
          This estimate became{" "}
          <NextLink
            href={`/invoices/${estimate.converted_invoice_id}`}
            className="font-medium text-accent hover:underline"
          >
            {convertedInvoiceNumber ? `invoice ${convertedInvoiceNumber}` : "a draft invoice"}
          </NextLink>
          {estimate.converted_at ? ` on ${formatDate(estimate.converted_at)}` : ""}. Its
          figures are frozen here. Any changes happen on the invoice.
        </LAlert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-7">
          <HeaderForm estimate={estimate} clients={clients} locked={!draft} />

          <LCard>
            <p className="mb-3 text-lead font-bold text-ink">Lines</p>
            <LinesEditor estimateId={estimate.id} lines={lines} editable={draft} />

            <LSeparator />

            {totalsError ? (
              <p className="text-crit">{friendlyDbError(totalsError, "estimate_totals.select")}</p>
            ) : (
              <div className="flex flex-col items-end gap-1">
                <TotalsLine label="Subtotal" value={totals?.subtotal_cents ?? 0} />
                <TotalsLine label="Tax" value={totals?.tax_cents ?? 0} />
                <TotalsLine label="Total" value={totals?.total_cents ?? 0} emphasize />
              </div>
            )}
          </LCard>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-5">
          <StatusActions
            estimate={{
              id: estimate.id,
              status: estimate.status,
              estimate_number: estimate.estimate_number,
              converted_invoice_id: estimate.converted_invoice_id,
            }}
            hasLines={lines.length > 0}
            expiredDays={expiredRow?.days_expired ?? null}
            clientName={clients.find((c) => c.id === estimate.client_id)?.name ?? "this client"}
          />
          <LCard>
            <p className="mb-1 text-body-s font-semibold text-ink">What an estimate is</p>
            <p className="text-caption text-ink-3">
              A quote, not a financial record: no payment can be recorded
              against it and it appears in no tax report. Converting on
              acceptance creates a draft invoice you still review and send.
            </p>
          </LCard>
        </div>
      </div>
    </LPageShell>
  );
}

function TotalsLine({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <div className="flex min-w-56 justify-between gap-4">
      <span className={emphasize ? "font-bold text-ink-2" : "text-ink-2"}>{label}</span>
      <span className={emphasize ? "tnum-l font-bold" : "tnum-l"}>{formatCents(value)}</span>
    </div>
  );
}

/* Local inline icon — same posture as overview/page.tsx's own header rule
   and ../page.tsx's copy of it: Ledger screens carry no icon dependency. */
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
