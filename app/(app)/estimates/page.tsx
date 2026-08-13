import NextLink from "next/link";
import {
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  Link as RadixLink,
  Table,
  Text,
} from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { formatCents, formatDate } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { rowsOf, type DbErrorLike } from "@/lib/supabase/rows";
import EmptyState from "@/components/ui/empty-state";
import PageShell from "../page-shell";
import {
  ESTIMATE_STATUS_BADGE,
  ESTIMATE_STATUS_FALLBACK,
  type EstimateStatus,
} from "./estimate-lib";

export const metadata = { title: "Estimates" };

type EstimateListRow = {
  id: string;
  client_id: string;
  estimate_number: string | null;
  status: EstimateStatus;
  issued_on: string | null;
  valid_until: string | null;
  converted_invoice_id: string | null;
};

type TotalsRow = { estimate_id: string; total_cents: number };

/**
 * Supabase's Data API caps rows and truncates SILENTLY (200, not an
 * error) — same guard, same reasoning, as the invoices list.
 */
const LIST_LIMIT = 1000;

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "accepted", label: "Accepted" },
  { key: "declined", label: "Declined" },
  { key: "expired", label: "Expired" },
  { key: "all", label: "All" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  await requireEntitlement("estimates", "/estimates");
  const { show } = await searchParams;
  // "Open" (drafts still being written plus sent quotes awaiting an
  // answer) is the default view: a pilot opens this screen to find out
  // which quotes are still in play, not to reread ones already answered.
  const filter: FilterKey =
    (FILTERS.find((f) => f.key === show)?.key as FilterKey) ?? "open";

  const supabase = await createClient();
  // estimate_totals is the ONE source for an estimate's money and
  // estimates_expired the one source for past-valid-until-ness — read the
  // views rather than recomputing either here (their own comments in the
  // Phase 10 migration say exactly this). Totals are fetched AFTER these,
  // keyed to the rows actually shown — see the chunked read below.
  const [estimatesRes, expiredRes, clientsRes] = await Promise.all([
    supabase
      .from("estimates")
      .select(
        "id, client_id, estimate_number, status, issued_on, valid_until, converted_invoice_id"
      )
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT),
    supabase
      .from("estimates_expired")
      .select("estimate_id, days_expired")
      .limit(LIST_LIMIT),
    supabase.from("clients").select("id, name").limit(LIST_LIMIT),
  ]);

  const estimatesResult = rowsOf<EstimateListRow>(
    estimatesRes as { data: EstimateListRow[] | null; error: DbErrorLike | null }
  );
  const expiredResult = rowsOf<{ estimate_id: string; days_expired: number }>(
    expiredRes as {
      data: { estimate_id: string; days_expired: number }[] | null;
      error: DbErrorLike | null;
    }
  );
  const clientsResult = rowsOf<{ id: string; name: string }>(
    clientsRes as { data: { id: string; name: string }[] | null; error: DbErrorLike | null }
  );

  const estimates = estimatesResult.ok ? estimatesResult.rows : [];
  const expiredRows = expiredResult.ok ? expiredResult.rows : [];
  const expiredIds = new Set(expiredRows.map((e) => e.estimate_id));
  const clientNames = new Map(
    (clientsResult.ok ? clientsResult.rows : []).map((c) => [c.id, c.name])
  );

  const truncated = estimates.length === LIST_LIMIT;

  const awaitingCount = estimates.filter((e) => e.status === "sent").length;

  const visible = estimates.filter((estimate) => {
    switch (filter) {
      case "open":
        return estimate.status === "draft" || estimate.status === "sent";
      case "accepted":
        return estimate.status === "accepted";
      case "declined":
        return estimate.status === "declined";
      case "expired":
        return expiredIds.has(estimate.id);
      default:
        return true;
    }
  });

  // REVIEW FINDING (list totals join breaks past 1000): this used to be an
  // INDEPENDENT `estimate_totals` read capped at the same 1000 rows — but
  // unordered, so past 1000 estimates the two result sets diverged and
  // every unmatched row rendered a healthy gray $0.00. Totals are now
  // keyed to the ids actually shown with `.in(...)`, so a totals row can
  // only be missing if something is genuinely broken — and then it gets
  // the refusal treatment below, never $0.00 (the client statement's rule:
  // a missing invoice_totals row is "we could not find out").
  //
  // Chunked for the same URL-length reason as the import screens'
  // FINGERPRINT_LOOKUP_CHUNK: supabase-js emits `.in()` as a GET query
  // string, and 1000 uuids is ~37 KB of URL — past a conservative 8 KB
  // header budget. 100 uuids is ~3.7 KB, comfortably inside it.
  const TOTALS_IN_CHUNK = 100;
  const visibleIds = visible.map((estimate) => estimate.id);
  const totalsByEstimate = new Map<string, number>();
  let totalsError: DbErrorLike | null = null;
  for (let i = 0; i < visibleIds.length; i += TOTALS_IN_CHUNK) {
    const chunkResult = rowsOf<TotalsRow>(
      (await supabase
        .from("estimate_totals")
        .select("estimate_id, total_cents")
        .in("estimate_id", visibleIds.slice(i, i + TOTALS_IN_CHUNK))) as {
        data: TotalsRow[] | null;
        error: DbErrorLike | null;
      }
    );
    if (!chunkResult.ok) {
      totalsError = chunkResult.error;
      break;
    }
    for (const row of chunkResult.rows) {
      totalsByEstimate.set(row.estimate_id, row.total_cents);
    }
  }
  const missingTotalsCount = totalsError
    ? 0
    : visibleIds.filter((estimateId) => !totalsByEstimate.has(estimateId)).length;

  // A failed totals/expired/clients read is not "no data" — rendering a
  // sent quote as a healthy gray $0.00 because a view read failed is the
  // exact defect class lib/supabase/rows.ts exists to close. A totals row
  // MISSING from a read that succeeded gets the same treatment: the view
  // left-joins from pilot.estimates, so every estimate has exactly one
  // row, and a hole means the answer is "we could not find out".
  const firstError = !estimatesResult.ok
    ? estimatesResult.error
    : !expiredResult.ok
      ? expiredResult.error
      : !clientsResult.ok
        ? clientsResult.error
        : totalsError;
  const errorText = firstError
    ? friendlyDbError(firstError, "estimates.select")
    : missingTotalsCount > 0
      ? `The totals for ${missingTotalsCount} of these estimates couldn't be loaded, so the list isn't shown — a figure that couldn't be found must not appear as $0.00. Reload to try again.`
      : null;

  return (
    <PageShell
      title="Estimates"
      subtitle={
        errorText
          ? "Some figures below couldn't load — see the notice."
          : `${estimates.length} estimate${estimates.length === 1 ? "" : "s"}${
              awaitingCount ? ` · ${awaitingCount} awaiting an answer` : ""
            }${expiredIds.size ? ` · ${expiredIds.size} expired` : ""}`
      }
      action={
        <Button asChild>
          <NextLink href="/estimates/new">New estimate</NextLink>
        </Button>
      }
    >
      {truncated ? (
        <Callout.Root color="amber">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            Only the most recent {LIST_LIMIT} estimates could be loaded, so the
            list below covers those and not your whole history.
          </Callout.Text>
        </Callout.Root>
      ) : null}

      <Flex gap="2" wrap="wrap">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            asChild
            size="2"
            variant={filter === f.key ? "solid" : "soft"}
          >
            <NextLink href={f.key === "open" ? "/estimates" : `/estimates?show=${f.key}`}>
              {f.label}
            </NextLink>
          </Button>
        ))}
      </Flex>

      <Card size="3">
        {errorText ? (
          <Callout.Root color="red">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>{errorText}</Callout.Text>
          </Callout.Root>
        ) : visible.length === 0 ? (
          // "No estimates yet" is only true when there are none at all —
          // saying it while a filter hides the rest is the class of lie
          // the trips screens used to tell. Empty ≠ failed ≠ filtered.
          estimates.length === 0 ? (
            <EmptyState
              title="No estimates yet"
              action={
                <Button asChild>
                  <NextLink href="/estimates/new">Draft your first estimate</NextLink>
                </Button>
              }
            >
              Quote the trip before it&rsquo;s booked — day rates, travel days, per
              diem. When the client accepts, the estimate becomes a draft invoice
              without retyping a number.
            </EmptyState>
          ) : (
            <EmptyState
              title={
                filter === "open"
                  ? "Nothing open"
                  : filter === "expired"
                    ? "Nothing expired"
                    : "Nothing here"
              }
              action={
                <Button asChild variant="soft">
                  <NextLink href="/estimates?show=all">Show all estimates</NextLink>
                </Button>
              }
            >
              {filter === "open"
                ? `Every estimate has an answer. You have ${estimates.length} in total.`
                : `None of your ${estimates.length} estimates match this filter.`}
            </EmptyState>
          )
        ) : (
          <Table.Root variant="ghost">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Number</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Client</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Issued</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Valid until</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Total</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {visible.map((estimate) => {
                const badge = ESTIMATE_STATUS_BADGE[estimate.status] ?? ESTIMATE_STATUS_FALLBACK;
                const expired = expiredIds.has(estimate.id);
                return (
                  <Table.Row key={estimate.id}>
                    <Table.RowHeaderCell>
                      <RadixLink asChild weight="medium">
                        <NextLink href={`/estimates/${estimate.id}`}>
                          {estimate.estimate_number ?? "Draft"}
                        </NextLink>
                      </RadixLink>
                    </Table.RowHeaderCell>
                    <Table.Cell>
                      <Text color="gray">{clientNames.get(estimate.client_id) ?? "—"}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text color="gray">{formatDate(estimate.issued_on)}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text color={expired ? "amber" : "gray"} weight={expired ? "medium" : "regular"}>
                        {formatDate(estimate.valid_until)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Flex gap="1" wrap="wrap">
                        {/* estimates_expired only carries SENT quotes past
                            their date (an answered quote is no longer
                            waiting to expire), so this override can never
                            hide an Accepted or Declined badge. */}
                        {expired ? (
                          <Badge color="amber">Expired</Badge>
                        ) : (
                          <Badge color={badge.color}>{badge.label}</Badge>
                        )}
                        {estimate.converted_invoice_id ? (
                          <Badge color="gray">Invoiced</Badge>
                        ) : null}
                      </Flex>
                    </Table.Cell>
                    <Table.Cell justify="end">
                      {/* The table only renders when errorText is null, at
                          which point every visible id verifiably has a
                          totals row — but a missing one still refuses
                          rather than defaulting, so no future regression
                          in the gating above can quietly print $0.00 for
                          "we could not find out". */}
                      {totalsByEstimate.has(estimate.id) ? (
                        <Text weight="medium" className="tnum">
                          {formatCents(totalsByEstimate.get(estimate.id) as number)}
                        </Text>
                      ) : (
                        <Text size="1" color="red">
                          Couldn&rsquo;t load
                        </Text>
                      )}
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        )}
      </Card>
    </PageShell>
  );
}
