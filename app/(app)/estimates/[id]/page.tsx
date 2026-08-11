import NextLink from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Callout,
  Card,
  Flex,
  Grid,
  Link as RadixLink,
  Separator,
  Text,
} from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDate } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import PageShell from "../../page-shell";
import {
  ESTIMATE_STATUS_BADGE,
  ESTIMATE_STATUS_FALLBACK,
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

export default async function EstimatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ warning?: string }>;
}) {
  const { id } = await params;
  const { warning } = await searchParams;
  await requireAccount(`/estimates/${id}`);

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
    supabase.from("clients").select("id, name").order("name", { ascending: true }),
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
    <PageShell
      title={estimate.estimate_number ?? "Draft estimate"}
      subtitle={
        <Flex align="center" gap="2" mt="1">
          {expired ? (
            <Badge color="amber">Expired</Badge>
          ) : (
            <Badge color={badge.color}>{badge.label}</Badge>
          )}
          <Text color={expired ? "amber" : "gray"}>
            {estimate.issued_on ? `Sent ${formatDate(estimate.issued_on)}` : "Not yet sent"}
            {estimate.valid_until
              ? ` · Valid until ${formatDate(estimate.valid_until)}${expired ? " (passed)" : ""}`
              : ""}
          </Text>
        </Flex>
      }
    >
      {warning ? (
        <Callout.Root color="amber" mb="4">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>{warning}</Callout.Text>
        </Callout.Root>
      ) : null}

      {moneyError ? (
        <Callout.Root color="red" mb="4">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>{friendlyDbError(moneyError, "estimates.detail")}</Callout.Text>
        </Callout.Root>
      ) : null}

      {converted ? (
        <Callout.Root color="green" mb="4">
          <Callout.Text>
            This estimate became{" "}
            <RadixLink asChild weight="medium">
              <NextLink href={`/invoices/${estimate.converted_invoice_id}`}>
                {convertedInvoiceNumber
                  ? `invoice ${convertedInvoiceNumber}`
                  : "a draft invoice"}
              </NextLink>
            </RadixLink>
            {estimate.converted_at ? ` on ${formatDate(estimate.converted_at)}` : ""}. Its
            figures are frozen here — any changes happen on the invoice.
          </Callout.Text>
        </Callout.Root>
      ) : null}

      <Grid columns={{ initial: "1", lg: "12" }} gap="4">
        <Flex direction="column" gap="4" gridColumn={{ lg: "span 7" }}>
          <HeaderForm estimate={estimate} clients={clients} locked={!draft} />

          <Card size="3">
            <Text as="div" size="4" weight="bold" mb="3">
              Lines
            </Text>
            <LinesEditor estimateId={estimate.id} lines={lines} editable={draft} />

            <Separator size="4" my="4" />

            {totalsError ? (
              <Text color="red">{friendlyDbError(totalsError, "estimate_totals.select")}</Text>
            ) : (
              <Flex direction="column" gap="1" align="end">
                <TotalsLine label="Subtotal" value={totals?.subtotal_cents ?? 0} />
                <TotalsLine label="Tax" value={totals?.tax_cents ?? 0} />
                <TotalsLine label="Total" value={totals?.total_cents ?? 0} emphasize />
              </Flex>
            )}
          </Card>
        </Flex>

        <Flex direction="column" gap="4" gridColumn={{ lg: "span 5" }}>
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
          <Card size="3">
            <Text as="div" size="2" weight="bold" mb="1">
              What an estimate is
            </Text>
            <Text as="div" size="1" color="gray">
              A quote, not an invoice: it isn&rsquo;t a financial record, no payment
              can be recorded against it, and it doesn&rsquo;t appear in tax reports.
              When the client accepts, converting it creates a draft invoice you
              still review and send.
            </Text>
          </Card>
        </Flex>
      </Grid>
    </PageShell>
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
    <Flex gap="4" minWidth="220px" justify="between">
      <Text color="gray" weight={emphasize ? "bold" : "regular"}>
        {label}
      </Text>
      <Text weight={emphasize ? "bold" : "regular"} className="tnum">
        {formatCents(value)}
      </Text>
    </Flex>
  );
}
