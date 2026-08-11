import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { rowsOf, type DbErrorLike } from "@/lib/supabase/rows";
import {
  assembleStatement,
  type StatementInvoice,
  type StatementInvoiceTotals,
  type StatementOverdue,
  type StatementPeriod,
  type StatementRow,
  type StatementTotals,
} from "./statement-lib";

type Supa = Awaited<ReturnType<typeof createClient>>;

/**
 * Same cap discipline as every list read in this app (see the LIST_LIMIT
 * note in app/(app)/invoices/page.tsx): the Data API clamps to 1000 rows
 * and TRUNCATES SILENTLY, and the guard below detects the cap by exact
 * equality, so a limit above the server's own clamp would be dead code.
 */
export const STATEMENT_LIST_LIMIT = 1000;

export type StatementParty = {
  name: string;
  contact_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
};

export type ClientStatement = {
  client: StatementParty;
  clientArchived: boolean;
  period: StatementPeriod;
  rows: StatementRow[];
  totals: StatementTotals;
  /** True when the invoice list hit STATEMENT_LIST_LIMIT — the figures may
   *  be partial. The page renders this as a loud callout; the print route
   *  refuses to emit at all (same rule as the CSV exports). */
  truncated: boolean;
};

export type ClientStatementResult =
  | { ok: true; statement: ClientStatement }
  | { ok: false; reason: "not_found" | "load_failed"; error: DbErrorLike };

/**
 * ONE data assembly for both statement surfaces — the screen and the print
 * view — for the same reason lib/invoice-document.tsx exists: two renderers
 * reading two query sets would eventually disagree, and here the
 * disagreement would be between what the pilot checks on screen and the
 * document their client's AP department actually pays from.
 *
 * WHERE EACH NUMBER COMES FROM, stated once:
 *   - which invoices:   pilot.invoices — issued_on within [from, to],
 *                       status in ('sent','partial','paid'). Drafts were
 *                       never sent; voids are not owed; both are excluded
 *                       and the statement says so in copy. The DB
 *                       guarantees every issued invoice has issued_on
 *                       (invoices_assign_number_on_issue sets it on the
 *                       draft→sent transition), so the date filter cannot
 *                       silently drop an issued invoice.
 *   - money:            pilot.invoice_totals — total_cents,
 *                       amount_paid_cents, balance_due_cents. Never
 *                       recomputed from lines or payments here.
 *   - past-due-ness:    pilot.invoices_overdue — days_overdue. Never
 *                       recomputed from due_on here.
 *
 * Failure semantics mirror buildInvoiceDocument's: a missing client (which
 * under RLS is indistinguishable from another tenant's client, and must
 * stay that way) is "not_found"; any failed read is "load_failed" and the
 * caller renders a visible failure — never an empty statement that reads
 * as "this client owes nothing".
 */
export async function buildClientStatement(
  supabase: Supa,
  accountId: string,
  clientId: string,
  period: StatementPeriod
): Promise<ClientStatementResult> {
  const { data: clientData, error: clientError } = await supabase
    .from("clients")
    .select(
      "name, contact_name, address_line1, address_line2, city, state, postal_code, country, archived_at"
    )
    .eq("id", clientId)
    .eq("account_id", accountId) // defence in depth alongside RLS
    .maybeSingle();

  // A failed query is not a missing client — see the note in
  // app/(app)/clients/[id]/page.tsx.
  if (clientError) {
    return { ok: false, reason: "load_failed", error: clientError };
  }
  const client = clientData as (StatementParty & { archived_at: string | null }) | null;
  if (!client) {
    return {
      ok: false,
      reason: "not_found",
      error: { code: null, message: "Not found." },
    };
  }

  const invoicesResult = rowsOf<StatementInvoice>(
    await supabase
      .from("invoices")
      .select("id, invoice_number, status, issued_on, due_on")
      .eq("account_id", accountId)
      .eq("client_id", clientId)
      .in("status", ["sent", "partial", "paid"])
      .gte("issued_on", period.from)
      .lte("issued_on", period.to)
      .order("issued_on", { ascending: true })
      .order("invoice_number", { ascending: true })
      .limit(STATEMENT_LIST_LIMIT)
  );
  if (!invoicesResult.ok) {
    return { ok: false, reason: "load_failed", error: invoicesResult.error };
  }

  const invoices = invoicesResult.rows;
  const truncated = invoices.length === STATEMENT_LIST_LIMIT;

  // A genuinely empty period is a VALID statement ("no invoices were issued
  // in this range") — reached only after the invoice read verifiably
  // succeeded above, so it can never be a failed read wearing an empty
  // statement's clothes.
  if (invoices.length === 0) {
    return {
      ok: true,
      statement: {
        client,
        clientArchived: Boolean(client.archived_at),
        period,
        rows: [],
        totals: { invoicedCents: 0, paidCents: 0, outstandingCents: 0 },
        truncated: false,
      },
    };
  }

  const invoiceIds = invoices.map((invoice) => invoice.id);
  const [totalsRes, overdueRes] = await Promise.all([
    supabase
      .from("invoice_totals")
      .select("invoice_id, total_cents, amount_paid_cents, balance_due_cents")
      .eq("account_id", accountId)
      .in("invoice_id", invoiceIds)
      .limit(STATEMENT_LIST_LIMIT),
    supabase
      .from("invoices_overdue")
      .select("invoice_id, days_overdue")
      .eq("account_id", accountId)
      .in("invoice_id", invoiceIds)
      .limit(STATEMENT_LIST_LIMIT),
  ]);

  const totalsResult = rowsOf<StatementInvoiceTotals>(totalsRes);
  if (!totalsResult.ok) {
    return { ok: false, reason: "load_failed", error: totalsResult.error };
  }
  // A failed overdue read is folded in as a hard failure, matching
  // app/(app)/invoices/page.tsx's firstError treatment: a statement that
  // silently presents overdue invoices as current misstates the one thing
  // the recipient's AP department is being asked to act on.
  const overdueResult = rowsOf<StatementOverdue>(overdueRes);
  if (!overdueResult.ok) {
    return { ok: false, reason: "load_failed", error: overdueResult.error };
  }

  const assembly = assembleStatement(
    invoices,
    totalsResult.rows,
    overdueResult.rows
  );
  // An invoice with no invoice_totals row is "we could not find out", never
  // "$0.00" — see assembleStatement's header.
  if (!assembly.ok) {
    return {
      ok: false,
      reason: "load_failed",
      error: {
        code: null,
        message: `invoice_totals returned no row for ${assembly.missingTotalsFor.length} invoice(s) on this statement`,
      },
    };
  }

  return {
    ok: true,
    statement: {
      client,
      clientArchived: Boolean(client.archived_at),
      period,
      rows: assembly.rows,
      totals: assembly.totals,
      truncated,
    },
  };
}
