import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { rowsOf } from "@/lib/supabase/rows";
import { idChunks } from "@/lib/id-chunks";
import { logbookFrom } from "../../logbook/db";

type Supa = Awaited<ReturnType<typeof createClient>>;

/**
 * THE READS behind the History panel (history-panel.tsx) — every trip,
 * invoice, payment and estimate this account has ever recorded against one
 * client, plus which of the fleet has flown for them. Split into its own
 * file for the same reason payment-insight.ts and statement/queries.ts are
 * split from their panels: page.tsx's own query block (H8b's Unbilled
 * trips / Outstanding invoices, right above where this mounts) stays small
 * and untouched, and this file can be read start to finish as "everything
 * History shows, and where every figure on it comes from."
 *
 * ONE HISTORY PANEL, FOUR INDEPENDENT TABS. A pilot opening the Payments
 * tab does not care whether the Estimates read happened to fail a moment
 * earlier, so each tab gets its OWN ok/fail result (HistoryTab<Row> below)
 * rather than one page-wide error that would blank all four over a single
 * bad read — the same reasoning page.tsx already applies by keeping
 * ratesLoadError, qualificationsLoadError, packetDocumentsLoadError, etc.
 * as separate flags instead of one. Within a tab, though, a failed read is
 * NEVER presented as "this client has none" — every branch below returns
 * `{ ok: false }` rather than an empty rows array on error, so
 * history-panel.tsx cannot accidentally collapse "couldn't load" into the
 * LEmpty case (the exact mistake lib/supabase/rows.ts exists to make
 * unrepresentable).
 *
 * MONEY, ONCE EACH, FROM ITS ONE SOURCE. Invoice totals and balances come
 * from pilot.invoice_totals, estimate totals from pilot.estimate_totals,
 * and trip value from pilot.trip_list_value — the exact same function
 * app/(app)/trips/page.tsx prices its own Value column from. None of the
 * three is recomputed here; see each section below for why.
 */

/**
 * Each tab shows at most this many rows, newest first. A HISTORY panel
 * that tried to render a decade of invoices unbounded would be the exact
 * "1000-row cap hit on every visit, forever" failure mode
 * pilot.trip_list_value's own migration describes — just arriving sooner,
 * since a tab embedded in a client's edit page has far less room than a
 * dedicated list screen. 25 is deliberately small and deliberately admits
 * it (history-panel.tsx renders "Latest 25 shown." whenever a tab hits it).
 *
 * THE +1-THEN-SLICE TRUNCATION CHECK every section below uses (`.limit(
 * HISTORY_LIST_LIMIT + 1)`, then `rows.slice(0, HISTORY_LIST_LIMIT)`, then
 * `all.length > HISTORY_LIST_LIMIT`) is the same idiom this exact file's
 * neighbour already uses for OPEN_TRIPS_LIMIT and OUTSTANDING_INVOICES_LIMIT
 * in page.tsx — matched here rather than the `length === LIMIT` idiom
 * trips/page.tsx and invoices/page.tsx use for THEIR caps. The two idioms
 * are not interchangeable at every cap size: those screens cap at 1000,
 * where a client's list landing on exactly that count by coincidence is
 * negligible, but 25 is small enough that a client with precisely 25
 * trips is an entirely ordinary thing to have, and `length === 25` would
 * misreport that client's complete history as truncated.
 */
export const HISTORY_LIST_LIMIT = 25;

/**
 * The lookup cap for THIS CLIENT's own invoices — read once, ordered
 * newest first, and used for two different things below: slicing the
 * first HISTORY_LIST_LIMIT off for the Invoices tab, and supplying every
 * id the Payments tab joins against. It is deliberately NOT the same
 * constant as HISTORY_LIST_LIMIT.
 *
 * WHY. pilot.invoice_payments carries no client_id of its own (only
 * invoice_id and account_id — see its Relationships in database.types.ts),
 * so "this client's payments" only exists by first asking "this client's
 * invoices" and joining through them. If that driving read were capped at
 * the same 25 the Invoices TAB displays, a payment against an invoice
 * older than this client's 25 most recent would silently vanish from the
 * Payments tab — "Latest 25 shown" would quietly mean "latest 25 among an
 * arbitrary, invoice-recency-limited subset," not what it says. Reading
 * the driving set once at a generous cap, independent of the display cap,
 * and looking up against it is the same shape
 * app/(app)/clients/[id]/payment-insight-panel.tsx already uses for its
 * own INSIGHT_LIMIT, for the identical reason.
 */
const CLIENT_INVOICE_LOOKUP_LIMIT = 1000;

/* ── Row shapes ────────────────────────────────────────────────────────
 * Raw DB/view columns keep their snake_case names (so a mismatch against
 * the actual column is easy to spot); a field this file JOINS in is
 * camelCase, the same split trips/page.tsx's tripValueByTrip map uses. */

export type HistoryTripRow = {
  id: string;
  starts_on: string;
  ends_on: string;
  // Loosely typed, like trips/page.tsx's own TripListRow.status — NOT cast
  // against Database["pilot"]["Tables"]["trips"]["Row"]["status"], whose
  // hand-authored union is missing 'hold' (20260814094000 added it to the
  // CHECK constraint; the generated types file was never regenerated to
  // match — see that migration's own header, "one value stale"). A cast
  // here would make a hold trip fail to match this file's own
  // STATUS_BADGE lookup in history-panel.tsx silently.
  status: string;
  /** From pilot.trip_list_value — see loadClientHistory's Trips section.
   *  Null when that read failed (tripValuesFailed below is set instead of
   *  losing the fact silently) or, in principle, when the function somehow
   *  returned no row for this trip; never a hand-summed fallback. */
  valueCents: number | null;
};

export type HistoryInvoiceRow = {
  id: string;
  invoice_number: string | null;
  issued_on: string | null;
  status: "draft" | "sent" | "partial" | "paid" | "void";
  /** pilot.invoice_totals — the one source, never lines summed here. Null
   *  only when that read failed; see the Invoices section. */
  totalCents: number | null;
  balanceDueCents: number | null;
};

export type HistoryPaymentRow = {
  id: string;
  invoice_id: string;
  paid_on: string;
  /** Negative on a correction row (pilot.invoice_payments.reverses_payment_id
   *  — see invoices/[id]/payment-panel.tsx). Not filtered out: a history
   *  panel that hid corrections would show a balance that no longer
   *  matches the payments printed above it. */
  amount_cents: number;
  method: "ach" | "check" | "wire" | "card" | "cash" | "other" | null;
  /** This payment's invoice's invoice_number, joined in from the same
   *  client-invoice lookup the Invoices tab reads (see
   *  CLIENT_INVOICE_LOOKUP_LIMIT). Null on the rare invoice that has no
   *  number (a draft cannot carry a payment, so in practice this is only
   *  null if the lookup itself came up short of this id — which the
   *  refusal branch below exists to prevent). */
  invoiceNumber: string | null;
};

export type HistoryEstimateRow = {
  id: string;
  estimate_number: string | null;
  issued_on: string | null;
  status: "draft" | "sent" | "accepted" | "declined";
  /** pilot.estimate_totals — the one source. Null only on a failed read. */
  totalCents: number | null;
};

/**
 * One tab's read, assembled or not — never an empty `rows` standing in for
 * a failure. history-panel.tsx must check `ok` before touching `rows`,
 * exactly like lib/supabase/rows.ts's QueryRows does for a single query;
 * this is the same guarantee at the tab's grain instead of one read's.
 */
export type HistoryTab<Row> =
  | { ok: true; rows: Row[]; truncated: boolean }
  | { ok: false };

export type ClientHistory = {
  trips: HistoryTab<HistoryTripRow>;
  /** pilot.trip_list_value failed. Independent of `trips.ok`: the base
   *  trips read can succeed (dates and status render) while this one
   *  fails (every valueCents is null and history-panel.tsx hides the
   *  Value column) — the same split trips/page.tsx's own dayGridError
   *  keeps from its primary trips-read error. */
  tripValuesFailed: boolean;
  invoices: HistoryTab<HistoryInvoiceRow>;
  payments: HistoryTab<HistoryPaymentRow>;
  estimates: HistoryTab<HistoryEstimateRow>;
  /** Tail numbers of this account's aircraft whose client_id is this
   *  client (app/(app)/aircraft/db.ts's AircraftRow.client_id —
   *  20260818220000_aircraft_client.sql). Ordered by tail_key. */
  aircraftTails: { ok: true; tails: string[]; truncated: boolean } | { ok: false };
};

const failedTab = <Row>(): HistoryTab<Row> => ({ ok: false });

/**
 * Everything the History panel shows for one client, assembled once. See
 * this file's header for the shape (one HistoryTab per list, never a
 * page-wide union) and CLIENT_INVOICE_LOOKUP_LIMIT for why the Invoices
 * and Payments sections share one driving read.
 */
export async function loadClientHistory(
  supabase: Supa,
  accountId: string,
  clientId: string
): Promise<ClientHistory> {
  const [tripsRes, clientInvoicesRes, estimatesRes, aircraftRes] = await Promise.all([
    supabase
      .from("trips")
      .select("id, starts_on, ends_on, status")
      .eq("account_id", accountId)
      .eq("client_id", clientId)
      .order("starts_on", { ascending: false })
      .limit(HISTORY_LIST_LIMIT + 1),
    // Read ONCE at CLIENT_INVOICE_LOOKUP_LIMIT — see that constant's
    // header. Drives both the Invoices tab (sliced to HISTORY_LIST_LIMIT
    // below) and the Payments tab's join.
    supabase
      .from("invoices")
      .select("id, invoice_number, issued_on, status")
      .eq("account_id", accountId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(CLIENT_INVOICE_LOOKUP_LIMIT),
    supabase
      .from("estimates")
      .select("id, estimate_number, issued_on, status")
      .eq("account_id", accountId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIST_LIMIT + 1),
    // pilot.aircraft is outside lib/supabase/database.types.ts (see
    // app/(app)/aircraft/db.ts's own header) — logbookFrom is its escape
    // hatch. Ordered by tail_key, the same normalised column the fleet
    // screen itself sorts by.
    logbookAircraftByClient(supabase, accountId, clientId),
  ]);

  // ---- Trips ---------------------------------------------------------
  const tripsRows = rowsOf<{ id: string; starts_on: string; ends_on: string; status: string }>(
    tripsRes
  );
  let trips: HistoryTab<HistoryTripRow> = failedTab<HistoryTripRow>();
  let tripValuesFailed = false;
  if (tripsRows.ok) {
    const truncated = tripsRows.rows.length > HISTORY_LIST_LIMIT;
    const shown = tripsRows.rows.slice(0, HISTORY_LIST_LIMIT);
    const valueByTrip = new Map<string, number>();
    if (shown.length > 0) {
      // pilot.trip_list_value(target_account_id) — the SAME function
      // app/(app)/trips/page.tsx prices its own Value column from (see
      // supabase/migrations/20260814094000_trip_list_value.sql). It takes
      // no client filter and returns one row per trip in the WHOLE
      // account, so it is called once here and filtered down to just the
      // trip ids shown on this tab — never hand-summed from trip_days,
      // per this feature's own hard constraint. Cast the same way
      // trips/page.tsx casts the call itself: the function has no entry
      // in the hand-authored database.types.ts (outside that file's
      // owner's allowlist to add — same gap the migration's header notes).
      const { data: valueData, error: valueError } = await (
        supabase as unknown as {
          rpc: (
            fn: string,
            args: Record<string, unknown>
          ) => Promise<{
            data: { trip_id: string; day_value_cents: number | string }[] | null;
            error: { message: string } | null;
          }>;
        }
      ).rpc("trip_list_value", { target_account_id: accountId });
      if (valueError) {
        tripValuesFailed = true;
      } else {
        for (const row of valueData ?? []) {
          valueByTrip.set(row.trip_id, Number(row.day_value_cents));
        }
      }
    }
    trips = {
      ok: true,
      truncated,
      rows: shown.map((trip) => ({
        ...trip,
        valueCents: tripValuesFailed ? null : (valueByTrip.get(trip.id) ?? null),
      })),
    };
  }

  // ---- Invoices + Payments (share the one driving read) --------------
  const clientInvoices = rowsOf<{
    id: string;
    invoice_number: string | null;
    issued_on: string | null;
    status: "draft" | "sent" | "partial" | "paid" | "void";
  }>(clientInvoicesRes);

  let invoices: HistoryTab<HistoryInvoiceRow> = failedTab<HistoryInvoiceRow>();
  let payments: HistoryTab<HistoryPaymentRow> = failedTab<HistoryPaymentRow>();

  if (!clientInvoices.ok) {
    // invoices and payments both stay failedTab().
  } else if (clientInvoices.rows.length === CLIENT_INVOICE_LOOKUP_LIMIT) {
    // More of this client's invoices than the lookup can read in one
    // pass — refuse both tabs that depend on it rather than show an
    // Invoices list that silently isn't "latest" or a Payments join that
    // silently missed older invoices. The same "a partial history must
    // not be presented as the whole one" rule payment-insight-panel.tsx
    // applies to its own ledger cap.
  } else {
    const allInvoices = clientInvoices.rows;
    const invoiceNumberById = new Map(allInvoices.map((inv) => [inv.id, inv.invoice_number]));

    // Invoices tab: the newest HISTORY_LIST_LIMIT of the set just read.
    const invoicesTruncated = allInvoices.length > HISTORY_LIST_LIMIT;
    const shownInvoices = allInvoices.slice(0, HISTORY_LIST_LIMIT);
    const shownIds = shownInvoices.map((inv) => inv.id);
    const totalsRes = shownIds.length
      ? rowsOf<{ invoice_id: string; total_cents: number; balance_due_cents: number }>(
          await supabase
            .from("invoice_totals")
            .select("invoice_id, total_cents, balance_due_cents")
            .eq("account_id", accountId)
            .in("invoice_id", shownIds)
            .limit(HISTORY_LIST_LIMIT)
        )
      : { ok: true as const, rows: [] as { invoice_id: string; total_cents: number; balance_due_cents: number }[] };

    if (totalsRes.ok) {
      const totalsByInvoice = new Map(totalsRes.rows.map((t) => [t.invoice_id, t]));
      invoices = {
        ok: true,
        truncated: invoicesTruncated,
        rows: shownInvoices.map((inv) => {
          const totals = totalsByInvoice.get(inv.id);
          return {
            ...inv,
            totalCents: totals?.total_cents ?? null,
            balanceDueCents: totals?.balance_due_cents ?? null,
          };
        }),
      };
    }

    // Payments tab: joined against EVERY id in allInvoices, not just the
    // 25 shown above — see CLIENT_INVOICE_LOOKUP_LIMIT. Chunked
    // (lib/id-chunks.ts) the same way app/(app)/clients/[id]/cost-panel.tsx
    // chunks its own per-client `.in("trip_id", …)` read: a `.in()` built
    // from up to CLIENT_INVOICE_LOOKUP_LIMIT uuids would otherwise put
    // ~39 KB of ids in the request URL.
    const allInvoiceIds = allInvoices.map((inv) => inv.id);
    if (allInvoiceIds.length === 0) {
      payments = { ok: true, rows: [], truncated: false };
    } else {
      type RawPaymentRow = {
        id: string;
        invoice_id: string;
        paid_on: string;
        amount_cents: number;
        method: "ach" | "check" | "wire" | "card" | "cash" | "other" | null;
      };
      const chunkResponses = await Promise.all(
        idChunks(allInvoiceIds).map((chunk) =>
          supabase
            .from("invoice_payments")
            .select("id, invoice_id, paid_on, amount_cents, method")
            .eq("account_id", accountId)
            .in("invoice_id", chunk)
            .limit(CLIENT_INVOICE_LOOKUP_LIMIT)
        )
      );
      const chunkResults = chunkResponses.map((res) => rowsOf<RawPaymentRow>(res));
      // Sorted and sliced in JS rather than in SQL: the driving set is
      // chunked across several requests (immediately above), so no single
      // request's ORDER BY/LIMIT can produce a globally-correct "newest
      // 25" — each chunk is read in full (bounded at
      // CLIENT_INVOICE_LOOKUP_LIMIT rows, the same cap-hit-means-refuse
      // rule as everywhere else) and the merge is sorted once here.
      if (chunkResults.some((c) => !c.ok)) {
        payments = failedTab<HistoryPaymentRow>();
      } else if (
        chunkResults.some((c) => c.ok && c.rows.length === CLIENT_INVOICE_LOOKUP_LIMIT)
      ) {
        // A single invoice's payment history is realistically a handful of
        // rows, so a chunk of at most 100 invoices returning
        // CLIENT_INVOICE_LOOKUP_LIMIT payment rows is not a real account —
        // refuse rather than merge a set that might itself be partial.
        payments = failedTab<HistoryPaymentRow>();
      } else {
        const merged = chunkResults.flatMap((c) => (c.ok ? c.rows : []));
        merged.sort((a, b) => {
          if (a.paid_on !== b.paid_on) return a.paid_on < b.paid_on ? 1 : -1;
          return a.id < b.id ? 1 : -1;
        });
        const truncated = merged.length > HISTORY_LIST_LIMIT;
        payments = {
          ok: true,
          truncated,
          rows: merged.slice(0, HISTORY_LIST_LIMIT).map((p) => ({
            ...p,
            invoiceNumber: invoiceNumberById.get(p.invoice_id) ?? null,
          })),
        };
      }
    }
  }

  // ---- Estimates -------------------------------------------------------
  const estimatesRows = rowsOf<{
    id: string;
    estimate_number: string | null;
    issued_on: string | null;
    status: "draft" | "sent" | "accepted" | "declined";
  }>(estimatesRes);
  let estimates: HistoryTab<HistoryEstimateRow> = failedTab<HistoryEstimateRow>();
  if (estimatesRows.ok) {
    const truncated = estimatesRows.rows.length > HISTORY_LIST_LIMIT;
    const shown = estimatesRows.rows.slice(0, HISTORY_LIST_LIMIT);
    const ids = shown.map((e) => e.id);
    const totalsRes = ids.length
      ? rowsOf<{ estimate_id: string; total_cents: number }>(
          await supabase
            .from("estimate_totals")
            .select("estimate_id, total_cents")
            .eq("account_id", accountId)
            .in("estimate_id", ids)
            .limit(HISTORY_LIST_LIMIT)
        )
      : { ok: true as const, rows: [] as { estimate_id: string; total_cents: number }[] };
    if (totalsRes.ok) {
      const totalsByEstimate = new Map(totalsRes.rows.map((t) => [t.estimate_id, t.total_cents]));
      estimates = {
        ok: true,
        truncated,
        rows: shown.map((e) => ({ ...e, totalCents: totalsByEstimate.get(e.id) ?? null })),
      };
    }
  }

  return {
    trips,
    tripValuesFailed,
    invoices,
    payments,
    estimates,
    aircraftTails: aircraftRes,
  };
}

/**
 * pilot.aircraft filtered to this client, tail numbers only — see
 * app/(app)/aircraft/db.ts's AircraftRow.client_id for what the column
 * means (a fact about the airframe, not any one trip) and
 * app/(app)/aircraft/page.tsx for the same ?client= relationship read the
 * other direction. Archived tails are NOT excluded: aircraft/page.tsx's
 * own "Flown for" filter doesn't exclude them either (the fleet query
 * only ORDERS archived tails last, it never drops them), and a tail
 * retired since is still part of this client's history.
 */
async function logbookAircraftByClient(
  supabase: Supa,
  accountId: string,
  clientId: string
): Promise<{ ok: true; tails: string[]; truncated: boolean } | { ok: false }> {
  const { data, error } = await logbookFrom(supabase, "aircraft")
    .select("tail_number")
    .eq("account_id", accountId)
    .eq("client_id", clientId)
    .order("tail_key", { ascending: true })
    .limit(HISTORY_LIST_LIMIT + 1);

  const rows = rowsOf<{ tail_number: string }>({ data, error });
  if (!rows.ok) return { ok: false };
  return {
    ok: true,
    truncated: rows.rows.length > HISTORY_LIST_LIMIT,
    tails: rows.rows.slice(0, HISTORY_LIST_LIMIT).map((r) => r.tail_number),
  };
}
