import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { rowsOf, type DbErrorLike } from "@/lib/supabase/rows";
import { csvRow } from "@/lib/csv";
import {
  EXPORT_ENTITIES,
  emptyLookups,
  slugify,
  type EntitySpec,
  type EstimateRef,
  type EstimateTotalsRef,
  type ExportTable,
  type InvoiceRef,
  type InvoiceTotalsRef,
  type Lookups,
  type TripRef,
} from "../entities";

// A data-portability export is always the current rows, never a cached
// artifact — same posture as /logbook/export.
export const dynamic = "force-dynamic";

/**
 * One route, twelve CSVs: /settings/export/clients, /settings/export/trips,
 * … — the registry in ../entities.ts says which. The streaming shape is
 * app/(app)/logbook/export/route.ts's, copied deliberately:
 *
 * PostgREST/the Supabase client default-caps a single request's rows
 * (commonly ~1000) and TRUNCATES SILENTLY rather than erroring. A page
 * size well under that cap, paged with .range(), is what lets these
 * routes promise "no row cap" — a partial export that LOOKS complete is
 * the worst possible outcome for the feature whose whole point is "you
 * can leave with your data."
 */
const PAGE_SIZE = 500;

type PilotClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Every table this route touches IS in lib/supabase/database.types.ts —
 * this cast exists because the table name arrives as a runtime value from
 * the registry, and supabase-js's typed `.from()` wants a literal (and
 * has already hit its generic-instantiation depth limit against the
 * hand-authored types once — see app/(app)/logbook/db.ts, whose
 * `logbookFrom` this mirrors). Row shapes are still checked: every
 * result passes through rowsOf() and is cast to the Pick<>-derived
 * mirror types ../entities.ts builds from the same database.types.ts.
 */
function exportFrom(
  supabase: PilotClient,
  table: ExportTable | "day_types" | "invoice_totals" | "estimate_totals"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return (supabase as unknown as { from: (t: string) => unknown }).from(table);
}

type Fetched<T> = { ok: true; rows: T[] } | { ok: false; error: DbErrorLike };

/**
 * The WHOLE of a (lookup) table, paged past the silent 1000-row cap the
 * same way the main stream is — a lookup that quietly stopped at 1000
 * clients would print "Unknown client" on row 1001's trips, which is a
 * lie with no error attached. Any failed page fails the whole fetch.
 */
async function fetchAll<T>(
  supabase: PilotClient,
  accountId: string,
  table: ExportTable | "day_types" | "invoice_totals" | "estimate_totals",
  select: string,
  orderColumn: string
): Promise<Fetched<T>> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const result = rowsOf<T>(
      await exportFrom(supabase, table)
        .select(select)
        .eq("account_id", accountId)
        .order(orderColumn, { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)
    );
    if (!result.ok) return result;
    all.push(...result.rows);
    offset += result.rows.length;
    if (result.rows.length < PAGE_SIZE) return { ok: true, rows: all };
  }
}

/**
 * Fills only the maps this entity's spec declares it needs. Runs BEFORE
 * the response begins, so a failed lookup is a clean 500 with a plain
 * explanation — never a CSV whose cross-referenced columns are silently
 * blank or wrong.
 */
async function buildLookups(
  supabase: PilotClient,
  accountId: string,
  spec: EntitySpec
): Promise<{ ok: true; lookups: Lookups } | { ok: false; what: string; error: DbErrorLike }> {
  const lookups = emptyLookups();

  if (spec.needs.clients) {
    const clients = await fetchAll<{ id: string; name: string }>(
      supabase, accountId, "clients", "id, name", "id"
    );
    if (!clients.ok) return { ok: false, what: "client names", error: clients.error };
    for (const c of clients.rows) lookups.clientNameById.set(c.id, c.name);
  }

  if (spec.needs.trips) {
    const trips = await fetchAll<TripRef & { id: string }>(
      supabase, accountId, "trips", "id, starts_on, aircraft_ident, client_id", "id"
    );
    if (!trips.ok) return { ok: false, what: "trips", error: trips.error };
    for (const t of trips.rows) {
      lookups.tripById.set(t.id, {
        starts_on: t.starts_on,
        aircraft_ident: t.aircraft_ident,
        client_id: t.client_id,
      });
    }
  }

  if (spec.needs.invoices) {
    const invoices = await fetchAll<InvoiceRef & { id: string }>(
      supabase, accountId, "invoices", "id, invoice_number, status, client_id", "id"
    );
    if (!invoices.ok) return { ok: false, what: "invoices", error: invoices.error };
    for (const i of invoices.rows) {
      lookups.invoiceById.set(i.id, {
        invoice_number: i.invoice_number,
        status: i.status,
        client_id: i.client_id,
      });
    }
  }

  if (spec.needs.dayTypes) {
    const dayTypes = await fetchAll<{ id: string; label: string }>(
      supabase, accountId, "day_types", "id, label", "id"
    );
    if (!dayTypes.ok) return { ok: false, what: "day types", error: dayTypes.error };
    for (const d of dayTypes.rows) lookups.dayTypeLabelById.set(d.id, d.label);
  }

  if (spec.needs.estimates) {
    const estimates = await fetchAll<EstimateRef & { id: string }>(
      supabase, accountId, "estimates", "id, estimate_number, status, client_id", "id"
    );
    if (!estimates.ok) return { ok: false, what: "estimates", error: estimates.error };
    for (const e of estimates.rows) {
      lookups.estimateById.set(e.id, {
        estimate_number: e.estimate_number,
        status: e.status,
        client_id: e.client_id,
      });
    }
  }

  if (spec.needs.estimateTotals) {
    const totals = await fetchAll<EstimateTotalsRef & { estimate_id: string }>(
      supabase,
      accountId,
      "estimate_totals",
      "estimate_id, subtotal_cents, tax_cents, total_cents",
      "estimate_id"
    );
    if (!totals.ok) return { ok: false, what: "estimate totals", error: totals.error };
    for (const t of totals.rows) {
      lookups.estimateTotalsByEstimateId.set(t.estimate_id, {
        subtotal_cents: t.subtotal_cents,
        tax_cents: t.tax_cents,
        total_cents: t.total_cents,
      });
    }
  }

  if (spec.needs.invoiceTotals) {
    const totals = await fetchAll<InvoiceTotalsRef & { invoice_id: string }>(
      supabase,
      accountId,
      "invoice_totals",
      "invoice_id, subtotal_cents, tax_cents, total_cents, amount_paid_cents, last_paid_on, balance_due_cents",
      "invoice_id"
    );
    if (!totals.ok) return { ok: false, what: "invoice totals", error: totals.error };
    for (const t of totals.rows) {
      lookups.totalsByInvoiceId.set(t.invoice_id, {
        subtotal_cents: t.subtotal_cents,
        tax_cents: t.tax_cents,
        total_cents: t.total_cents,
        amount_paid_cents: t.amount_paid_cents,
        last_paid_on: t.last_paid_on,
        balance_due_cents: t.balance_due_cents,
      });
    }
  }

  return { ok: true, lookups };
}

function pageQuery(
  supabase: PilotClient,
  spec: EntitySpec,
  accountId: string,
  from: number,
  to: number
) {
  let query = exportFrom(supabase, spec.table)
    .select(spec.select)
    .eq("account_id", accountId);
  for (const order of spec.orderBy) {
    query = query.order(order.column, { ascending: order.ascending });
  }
  return query.range(from, to) as PromiseLike<{
    data: Record<string, unknown>[] | null;
    error: DbErrorLike | null;
  }>;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ entity: string }> }
) {
  const { entity } = await params;
  const spec = EXPORT_ENTITIES[entity];
  if (!spec) {
    return NextResponse.json(
      { error: "No export by that name. The list of downloads is at /settings/export." },
      { status: 404 }
    );
  }

  const { account } = await requireAccount("/settings/export");
  const supabase = await createClient();

  // Everything that can fail cleanly fails BEFORE the first byte: the
  // cross-reference lookups and the first page are both fetched before
  // the streaming Response is constructed, so a bad query, an RLS reject
  // or a dead connection produces a real error status and zero bytes —
  // never a 200 wrapping an empty or half-joined file. (Same discipline,
  // same comment, as /logbook/export.)
  const built = await buildLookups(supabase, account.id, spec);
  if (!built.ok) {
    console.error(`[account export] ${entity}: ${built.what} lookup failed`, built.error);
    return NextResponse.json(
      {
        error:
          `Couldn't load the ${built.what} this export cross-references, so no file ` +
          "was produced. A download with those columns silently blank would look " +
          "complete and be wrong. Try again in a moment.",
      },
      { status: 500 }
    );
  }
  const { lookups } = built;

  const firstResult = rowsOf(
    await pageQuery(supabase, spec, account.id, 0, PAGE_SIZE - 1)
  );
  if (!firstResult.ok) {
    console.error(`[account export] ${entity}: first page fetch failed`, firstResult.error);
    return NextResponse.json(
      { error: "Couldn't read those records, so no file was produced. Try again in a moment." },
      { status: 500 }
    );
  }

  const encoder = new TextEncoder();
  let offset = 0;
  let firstBatch = firstResult.rows;
  let done = firstBatch.length < PAGE_SIZE;

  // Later pages are fetched lazily as the stream is pulled — that is what
  // makes "no row cap" true without buffering an unbounded table. If a
  // LATER page fails, headers are already sent and the status can no
  // longer change; the stream is aborted with controller.error(), which
  // tears the connection down rather than completing it. The client sees
  // a failed download, never bytes that look like a clean, complete CSV.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(csvRow([...spec.header])));
      for (const row of firstBatch) {
        controller.enqueue(encoder.encode(csvRow(spec.mapRow(row, lookups))));
      }
      offset += firstBatch.length;
      firstBatch = [];
      if (done) controller.close();
    },
    async pull(controller) {
      if (done) {
        controller.close();
        return;
      }
      const result = rowsOf(
        await pageQuery(supabase, spec, account.id, offset, offset + PAGE_SIZE - 1)
      );
      if (!result.ok) {
        console.error(`[account export] ${entity}: page fetch failed mid-stream`, result.error);
        controller.error(new Error(`account export ${entity} failed mid-stream`));
        return;
      }
      for (const row of result.rows) {
        controller.enqueue(encoder.encode(csvRow(spec.mapRow(row, lookups))));
      }
      offset += result.rows.length;
      if (result.rows.length < PAGE_SIZE) {
        done = true;
        controller.close();
      }
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `${spec.key}-${slugify(account.legal_name ?? account.id)}-${today}.csv`;

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Never cache an export of live business records.
      "Cache-Control": "no-store",
    },
  });
}
