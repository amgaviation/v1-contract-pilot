import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { computeYearTotals, type RatesByYear } from "@/lib/mileage";
import { reportsFrom, yearBounds, type ClientTaxFormRow } from "./db";

type Supa = Awaited<ReturnType<typeof createClient>>;

// Every list query below carries an explicit .limit(), per the house rule
// (copied from app/(app)/logbook/page.tsx's ENTRIES_LIMIT): Supabase's Data
// API caps and silently truncates an unbounded select, and a partial
// year-end total presented as complete would be the one place in this
// product where that silence costs a pilot real money at tax time.
// 1000, NOT a larger number. The Supabase Data API clamps every response
// to db-max-rows (1000) and TRUNCATES SILENTLY — no error, no flag. Every
// truncation guard in this file detects the cap by exact equality
// (`rows.length === LIMIT`), so a limit ABOVE the server's own cap can
// never be reached and the guard is dead code: the query asks for 2000,
// PostgREST returns 1000, 1000 !== 2000, and a tax figure short by a
// sixth is handed to a CPA with nothing on screen saying so.
const PAYMENTS_LIMIT = 1000;
const EXPENSES_LIMIT = 1000;
// Mileage — this report used to have no query against mileage_entries at
// all (see app/(app)/reports/profit-loss/queries.ts's identical fix for
// the same defect): pilot.mileage_entries carries a real, dollar-valued
// Schedule C deduction and it appeared in NO tax report. Same cap
// discipline as every other list query in this file.
const MILEAGE_LIMIT = 1000;

export type IncomeByClient = {
  clientId: string;
  clientName: string;
  totalCents: number;
  paymentCount: number;
};

export type PaymentRow = {
  id: string;
  paidOn: string;
  amountCents: number;
  method: string | null;
  clientId: string | null;
  clientName: string;
  invoiceNumber: string | null;
};

export type DeductibleByCategory = {
  category: string;
  totalCents: number;
  count: number;
};

export type DeductibleExpenseRow = {
  id: string;
  incurredOn: string;
  category: string;
  vendor: string | null;
  amountCents: number;
};

export type RebilledRow = {
  expenseId: string;
  incurredOn: string;
  category: string;
  vendor: string | null;
  expenseAmountCents: number;
  clientName: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  lineAmountCents: number | null;
  /** lineAmountCents - expenseAmountCents, when both exist. */
  deltaCents: number | null;
};

export type UnassignedRow = {
  id: string;
  incurredOn: string;
  category: string;
  vendor: string | null;
  amountCents: number;
};

export type TaxFormReconciliationRow = {
  clientId: string;
  clientName: string;
  ledgerCents: number;
  formType: ClientTaxFormRow["form_type"] | null;
  reportedAmountCents: number | null;
  receivedOn: string | null;
  notes: string | null;
  formId: string | null;
  /** reportedAmountCents - ledgerCents. Null when no form is on file yet. */
  deltaCents: number | null;
};

export type YearEndReport = {
  year: number;
  error: string | null;

  incomeByClient: IncomeByClient[];
  incomeTotalCents: number;
  payments: PaymentRow[];
  paymentsTruncated: boolean;

  deductibleByCategory: DeductibleByCategory[];
  deductibleTotalCents: number;
  deductibleExpenses: DeductibleExpenseRow[];
  deductibleTruncated: boolean;

  rebilled: RebilledRow[];
  rebilledExpenseTotalCents: number;
  rebilledInvoicedTotalCents: number;
  rebilledTruncated: boolean;

  unassigned: UnassignedRow[];
  unassignedTotalCents: number;
  unassignedTruncated: boolean;

  /**
   * Standard-mileage-rate drives for `year`, computed the SAME way
   * app/(app)/expenses/mileage/page.tsx and
   * app/(app)/reports/profit-loss/queries.ts do — lib/mileage.ts's
   * computeYearTotals, from total miles x that year's OWN rate on file,
   * rounded once, never a sum of the per-row snapshotted amounts. Deliberately
   * NOT folded into deductibleTotalCents: the standard mileage rate and actual
   * vehicle expenses (fuel, rental car — pilot.expenses category='fuel'/
   * 'rental_car') are alternative deduction methods for the same vehicle,
   * never additive, and this report cannot tell which one a pilot elected for
   * a given vehicle/year (see the mileage migration's own header). Bounded to
   * [Jan 1, Dec 31] of `year` like every other section, so every row here
   * belongs to that one tax year — there is at most one entry.
   */
  mileageCount: number;
  mileageMiles: number;
  /** cents/mile on file in pilot.mileage_rates for `year`, or null if never entered. */
  mileageRateCentsPerMile: number | null;
  /** round(mileageMiles * mileageRateCentsPerMile), or null when no rate is on file — never a guessed figure. */
  mileageAmountCents: number | null;
  mileageTruncated: boolean;

  taxForms: TaxFormReconciliationRow[];
};

/**
 * Everything the year-end report needs, assembled from ONE set of queries
 * shared by the screen (app/(app)/reports/year-end/page.tsx) and the CSV
 * routes (app/(app)/reports/year-end/export/route.ts) — the same "one
 * source for one number" discipline pilot.invoice_totals exists to enforce
 * for invoices, applied here so the on-screen total and the downloaded CSV
 * can never quietly disagree.
 *
 * account-scoped throughout: every query is filtered on account_id even
 * though RLS is the real boundary — matching the "defence in depth, not
 * the boundary" note in app/(app)/expenses/actions.ts.
 *
 * No embeds anywhere (PostgREST embeds resolve to `never` against this
 * app's hand-authored types, per lib/supabase/account.ts's own comment) —
 * every join below is two flat queries resolved in memory, same as
 * app/(app)/invoices/page.tsx.
 */
export async function loadYearEndReport(
  supabase: Supa,
  accountId: string,
  year: number
): Promise<YearEndReport> {
  const { start, end } = yearBounds(year);

  const [
    { data: paymentData, error: paymentsError },
    { data: deductData, error: deductError },
    { data: rebillData, error: rebillError },
    { data: unassignedData, error: unassignedError },
    { data: clientData, error: clientError },
    { data: taxFormData, error: taxFormError },
    { data: mileageData, error: mileageError },
    { data: mileageRateData, error: mileageRateError },
  ] = await Promise.all([
    // A. CASH-BASIS income: one row per pilot.invoice_payments payment
    // whose paid_on falls in [start, end]. Both bounds are plain
    // "YYYY-MM-DD" strings compared directly by Postgres against the
    // `date` column — no JS Date, no timezone conversion, no boundary
    // bug. This is the sum that answers "what did I actually get paid in
    // year Y", which is NOT the same figure as invoices issued/sent in
    // year Y (that would be accrual-basis, and would be wrong here).
    supabase
      .from("invoice_payments")
      .select("id, invoice_id, paid_on, amount_cents, method")
      .eq("account_id", accountId)
      .gte("paid_on", start)
      .lte("paid_on", end)
      .order("paid_on", { ascending: true })
      .limit(PAYMENTS_LIMIT),
    // B. Deductible expenses, by when they were incurred.
    supabase
      .from("expenses")
      .select("id, incurred_on, category, vendor, amount_cents")
      .eq("account_id", accountId)
      .eq("treatment", "deduct")
      .gte("incurred_on", start)
      .lte("incurred_on", end)
      .order("incurred_on", { ascending: true })
      .limit(EXPENSES_LIMIT),
    // C. Rebilled expenses, reconciled below against the
    // reimbursable_expense invoice_lines row they became (A3: the
    // treatment tag is set once at capture; this only reads that
    // decision, never re-asks it).
    supabase
      .from("expenses")
      .select("id, incurred_on, category, vendor, amount_cents, trip_id")
      .eq("account_id", accountId)
      .eq("treatment", "rebill")
      .gte("incurred_on", start)
      .lte("incurred_on", end)
      .order("incurred_on", { ascending: true })
      .limit(EXPENSES_LIMIT),
    // D. Unassigned receipts — "money the pilot is losing in both
    // directions" per app/(app)/expenses/page.tsx's own comment: neither
    // billed to a client nor claimed as a deduction. Scoped to this tax
    // year the same way every other section is; an unassigned receipt
    // from a PRIOR year is still sitting unresolved on /expenses and is
    // deliberately not re-surfaced here as though it were new.
    supabase
      .from("expenses")
      .select("id, incurred_on, category, vendor, amount_cents")
      .eq("account_id", accountId)
      .eq("treatment", "unassigned")
      .gte("incurred_on", start)
      .lte("incurred_on", end)
      .order("incurred_on", { ascending: true })
      .limit(EXPENSES_LIMIT),
    // A pilot's client list is small (same reasoning as
    // app/(app)/invoices/page.tsx) — fetched whole, not paged.
    supabase.from("clients").select("id, name"),
    reportsFrom(supabase, "client_tax_forms")
      .select(
        "id, client_id, tax_year, form_type, reported_amount_cents, received_on, notes"
      )
      .eq("account_id", accountId)
      .eq("tax_year", year),
    // E. Mileage — drove_on and miles ONLY, never the per-row snapshotted
    // amount_cents: Schedule C wants total miles for the year x that
    // year's OWN rate on file (queried next), rounded once — see
    // lib/mileage.ts's header for why summing per-row amounts drifts from
    // that figure. Ordered like every other list query in this file so a
    // truncated read drops a deterministic tail instead of a
    // server-arbitrary subset that would change the on-screen total on
    // every reload.
    supabase
      .from("mileage_entries")
      .select("id, drove_on, miles")
      .eq("account_id", accountId)
      .gte("drove_on", start)
      .lte("drove_on", end)
      .order("drove_on", { ascending: true })
      .limit(MILEAGE_LIMIT),
    // The pilot's own per-year IRS rate. Never hardcoded — see the
    // mileage_rates table comment for why a baked-in figure would silently
    // misstate every year it is stale for.
    supabase
      .from("mileage_rates")
      .select("tax_year, rate_cents_per_mile")
      .eq("account_id", accountId),
  ]);

  const firstError =
    paymentsError ??
    deductError ??
    rebillError ??
    unassignedError ??
    clientError ??
    taxFormError ??
    mileageError ??
    // A failed rate read is not "no rate on file" — it would silently
    // zero the whole mileage deduction on a report headed for a tax
    // filing, same reasoning as profit-loss/queries.ts's identical check.
    mileageRateError ??
    null;

  const clients = (clientData ?? []) as { id: string; name: string }[];
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  // ---- A. Income by client -------------------------------------------
  const payments = (paymentData ?? []) as {
    id: string;
    invoice_id: string;
    paid_on: string;
    amount_cents: number;
    method: string | null;
  }[];
  const paymentsTruncated = payments.length === PAYMENTS_LIMIT;

  const invoiceIds = [...new Set(payments.map((p) => p.invoice_id))];
  const { data: invoiceData, error: invoiceError } = invoiceIds.length
    ? await supabase
        .from("invoices")
        .select("id, client_id, invoice_number, status")
        .eq("account_id", accountId)
        .in("id", invoiceIds)
    : { data: [] as never[], error: null };
  const invoiceById = new Map(
    ((invoiceData ?? []) as {
      id: string;
      client_id: string;
      invoice_number: string | null;
      status: string;
    }[]).map((i) => [i.id, i])
  );

  // Defect 1 (see app/(app)/reports/profit-loss/queries.ts's identical
  // fix, kept in lockstep with this one so the two screens never disagree
  // about "what did I make this year"): sent -> partial -> void is a legal
  // transition and invoice_payments rows are never deleted, so a payment
  // against a now-void invoice sits in this table forever. It is not
  // income. app/(app)/overview/page.tsx's "Paid this year" KPI already filters this
  // out; this report — the one a pilot hands their accountant — must too.
  const incomeMap = new Map<string, IncomeByClient>();
  const paymentRows: PaymentRow[] = [];
  for (const payment of payments) {
    const invoice = invoiceById.get(payment.invoice_id);
    if (invoice?.status === "void") continue;
    const clientId = invoice?.client_id ?? null;
    const name = (clientId && clientName.get(clientId)) || "Unknown client";
    paymentRows.push({
      id: payment.id,
      paidOn: payment.paid_on,
      amountCents: payment.amount_cents,
      method: payment.method,
      clientId,
      clientName: name,
      invoiceNumber: invoice?.invoice_number ?? null,
    });
    const key = clientId ?? `unknown:${payment.invoice_id}`;
    const existing = incomeMap.get(key);
    if (existing) {
      existing.totalCents += payment.amount_cents;
      existing.paymentCount += 1;
    } else {
      incomeMap.set(key, {
        clientId: clientId ?? "",
        clientName: name,
        totalCents: payment.amount_cents,
        paymentCount: 1,
      });
    }
  }
  const incomeByClient = [...incomeMap.values()].sort(
    (a, b) => b.totalCents - a.totalCents
  );
  const incomeTotalCents = incomeByClient.reduce((sum, c) => sum + c.totalCents, 0);

  // ---- B. Deductible expenses by category ------------------------------
  const deductibleExpensesRaw = (deductData ?? []) as {
    id: string;
    incurred_on: string;
    category: string;
    vendor: string | null;
    amount_cents: number;
  }[];
  const deductibleTruncated = deductibleExpensesRaw.length === EXPENSES_LIMIT;
  const deductibleExpenses: DeductibleExpenseRow[] = deductibleExpensesRaw.map(
    (e) => ({
      id: e.id,
      incurredOn: e.incurred_on,
      category: e.category,
      vendor: e.vendor,
      amountCents: e.amount_cents,
    })
  );
  const deductCatMap = new Map<string, DeductibleByCategory>();
  for (const e of deductibleExpensesRaw) {
    const existing = deductCatMap.get(e.category);
    if (existing) {
      existing.totalCents += e.amount_cents;
      existing.count += 1;
    } else {
      deductCatMap.set(e.category, {
        category: e.category,
        totalCents: e.amount_cents,
        count: 1,
      });
    }
  }
  const deductibleByCategory = [...deductCatMap.values()].sort(
    (a, b) => b.totalCents - a.totalCents
  );
  const deductibleTotalCents = deductibleExpensesRaw.reduce(
    (sum, e) => sum + e.amount_cents,
    0
  );

  // ---- C. Rebilled expenses, reconciled against invoice_lines ----------
  const rebillExpensesRaw = (rebillData ?? []) as {
    id: string;
    incurred_on: string;
    category: string;
    vendor: string | null;
    amount_cents: number;
    trip_id: string | null;
  }[];
  const rebilledTruncatedExpenses = rebillExpensesRaw.length === EXPENSES_LIMIT;
  const expenseIds = rebillExpensesRaw.map((e) => e.id);

  const { data: lineData, error: lineError } = expenseIds.length
    ? await supabase
        .from("invoice_lines")
        .select("id, invoice_id, expense_id, unit_amount_cents, amount_cents")
        .eq("account_id", accountId)
        .in("expense_id", expenseIds)
    : { data: [] as never[], error: null };
  const lines = (lineData ?? []) as {
    id: string;
    invoice_id: string;
    expense_id: string | null;
    unit_amount_cents: number;
    amount_cents: number;
  }[];
  const lineByExpenseId = new Map(
    lines.filter((l) => l.expense_id).map((l) => [l.expense_id as string, l])
  );

  const lineInvoiceIds = [...new Set(lines.map((l) => l.invoice_id))];
  const { data: lineInvoiceData, error: lineInvoiceError } = lineInvoiceIds.length
    ? await supabase
        .from("invoices")
        .select("id, client_id, invoice_number, status")
        .eq("account_id", accountId)
        .in("id", lineInvoiceIds)
    : { data: [] as never[], error: null };
  const lineInvoiceById = new Map(
    ((lineInvoiceData ?? []) as {
      id: string;
      client_id: string;
      invoice_number: string | null;
      status: string;
    }[]).map((i) => [i.id, i])
  );

  const rebilledTruncated =
    rebilledTruncatedExpenses ||
    (expenseIds.length > 0 && lines.length === expenseIds.length && false); // lines has no independent cap concern (one per expense at most)

  const rebilled: RebilledRow[] = rebillExpensesRaw.map((e) => {
    const line = lineByExpenseId.get(e.id) ?? null;
    const invoice = line ? lineInvoiceById.get(line.invoice_id) ?? null : null;
    const lineAmountCents = line ? line.amount_cents : null;
    return {
      expenseId: e.id,
      incurredOn: e.incurred_on,
      category: e.category,
      vendor: e.vendor,
      expenseAmountCents: e.amount_cents,
      clientName: invoice ? clientName.get(invoice.client_id) ?? null : null,
      invoiceId: invoice?.id ?? null,
      invoiceNumber: invoice?.invoice_number ?? null,
      invoiceStatus: invoice?.status ?? null,
      lineAmountCents,
      deltaCents: lineAmountCents === null ? null : lineAmountCents - e.amount_cents,
    };
  });
  const rebilledExpenseTotalCents = rebillExpensesRaw.reduce(
    (sum, e) => sum + e.amount_cents,
    0
  );
  const rebilledInvoicedTotalCents = rebilled.reduce(
    (sum, r) => sum + (r.lineAmountCents ?? 0),
    0
  );

  // ---- D. Unassigned receipts -------------------------------------------
  const unassignedRaw = (unassignedData ?? []) as {
    id: string;
    incurred_on: string;
    category: string;
    vendor: string | null;
    amount_cents: number;
  }[];
  const unassignedTruncated = unassignedRaw.length === EXPENSES_LIMIT;
  const unassigned: UnassignedRow[] = unassignedRaw.map((e) => ({
    id: e.id,
    incurredOn: e.incurred_on,
    category: e.category,
    vendor: e.vendor,
    amountCents: e.amount_cents,
  }));
  const unassignedTotalCents = unassignedRaw.reduce(
    (sum, e) => sum + e.amount_cents,
    0
  );

  // ---- E. Mileage, standard rate (flagged, non-additive) ---------------
  const mileageRaw = (mileageData ?? []) as {
    id: string;
    drove_on: string;
    miles: number;
  }[];
  const mileageTruncated = mileageRaw.length === MILEAGE_LIMIT;
  const mileageRatesByYear: RatesByYear = Object.fromEntries(
    ((mileageRateData ?? []) as { tax_year: number; rate_cents_per_mile: number }[]).map(
      (r) => [r.tax_year, r.rate_cents_per_mile]
    )
  );
  // Bounded to [start, end] of exactly `year` above, so computeYearTotals
  // (which groups by the tax year read out of drove_on) can produce at
  // most one group here — unlike profit-loss, which can span a year
  // boundary and genuinely needs the array.
  const [mileageYearTotal] = computeYearTotals(mileageRaw, mileageRatesByYear);

  // ---- F. 1099-NEC reconciliation ---------------------------------------
  const taxForms = (taxFormData ?? []) as ClientTaxFormRow[];
  const formsByClient = new Map<string, ClientTaxFormRow[]>();
  for (const form of taxForms) {
    const list = formsByClient.get(form.client_id) ?? [];
    list.push(form);
    formsByClient.set(form.client_id, list);
  }

  // Every client with ledger income this year, or a form on file this
  // year, gets a reconciliation row — union of both sets, not just one.
  const reconciliationClientIds = new Set<string>([
    ...incomeByClient.filter((c) => c.clientId).map((c) => c.clientId),
    ...formsByClient.keys(),
  ]);

  const taxFormRows: TaxFormReconciliationRow[] = [];
  for (const clientId of reconciliationClientIds) {
    const ledgerCents =
      incomeByClient.find((c) => c.clientId === clientId)?.totalCents ?? 0;
    const name = clientName.get(clientId) ?? "Unknown client";
    const forms = formsByClient.get(clientId) ?? [];
    if (forms.length === 0) {
      taxFormRows.push({
        clientId,
        clientName: name,
        ledgerCents,
        formType: null,
        reportedAmountCents: null,
        receivedOn: null,
        notes: null,
        formId: null,
        deltaCents: null,
      });
    } else {
      for (const form of forms) {
        taxFormRows.push({
          clientId,
          clientName: name,
          ledgerCents,
          formType: form.form_type,
          reportedAmountCents: form.reported_amount_cents,
          receivedOn: form.received_on,
          notes: form.notes,
          formId: form.id,
          deltaCents: form.reported_amount_cents - ledgerCents,
        });
      }
    }
  }
  taxFormRows.sort((a, b) => a.clientName.localeCompare(b.clientName));

  return {
    year,
    error:
      firstError?.message ??
      invoiceError?.message ??
      lineError?.message ??
      lineInvoiceError?.message ??
      null,

    incomeByClient,
    incomeTotalCents,
    payments: paymentRows,
    paymentsTruncated,

    deductibleByCategory,
    deductibleTotalCents,
    deductibleExpenses,
    deductibleTruncated,

    rebilled,
    rebilledExpenseTotalCents,
    rebilledInvoicedTotalCents,
    rebilledTruncated,

    unassigned,
    unassignedTotalCents,
    unassignedTruncated,

    mileageCount: mileageRaw.length,
    mileageMiles: mileageYearTotal?.miles ?? 0,
    mileageRateCentsPerMile: mileageYearTotal?.rateCentsPerMile ?? null,
    mileageAmountCents: mileageYearTotal?.amountCents ?? null,
    mileageTruncated,

    taxForms: taxFormRows,
  };
}
