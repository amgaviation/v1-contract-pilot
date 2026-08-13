import type { createClient } from "@/lib/supabase/server";
import { BUILTIN_OPTIONS } from "@/lib/custom-options";
import { parseCalendarDate } from "@/lib/format";

/**
 * pilot.client_tax_forms (added by
 * supabase/migrations/20260807080000_client_tax_forms.sql) is not yet
 * represented in lib/supabase/database.types.ts. That file is hand-authored
 * and shared with two other agents editing sibling feature directories in
 * this same working tree concurrently — this phase's task boundary is
 * explicitly `app/(app)/reports/**`, `lib/nav.ts`, and the migration file
 * ONLY, so touching the shared types file would risk a collision for no
 * real benefit. This mirrors app/(app)/logbook/db.ts's own `logbookFrom`
 * escape hatch exactly: it does NOT loosen the shared typed client for any
 * other table (clients, invoices, invoice_payments, invoice_lines, expenses
 * all stay fully checked against the generated types), it only lets this
 * one new table name through `.from()`. Every payload sent through
 * `reportsFrom` is still typed against the Row/Insert/Update shapes below
 * before it reaches here.
 */
export type PilotClient = Awaited<ReturnType<typeof createClient>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function reportsFrom(supabase: PilotClient, table: "client_tax_forms"): any {
  return (supabase as unknown as { from: (t: string) => unknown }).from(table);
}

/** Mirrors pilot.client_tax_forms exactly — keep in lockstep with the migration. */
export type ClientTaxFormRow = {
  id: string;
  account_id: string;
  client_id: string;
  tax_year: number;
  form_type: "1099-NEC" | "1099-MISC" | "other";
  reported_amount_cents: number;
  received_on: string | null;
  document_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ClientTaxFormInsert = {
  account_id: string;
  client_id: string;
  tax_year: number;
  form_type?: "1099-NEC" | "1099-MISC" | "other";
  reported_amount_cents: number;
  received_on?: string | null;
  document_id?: string | null;
  notes?: string | null;
};

export type ClientTaxFormUpdate = Partial<
  Omit<ClientTaxFormInsert, "account_id">
>;

// ---------------------------------------------------------------------------
// Year-boundary helpers.
//
// The two calendar-date bounds below are plain "YYYY-MM-DD" STRINGS
// compared directly against a Postgres `date` column (paid_on/incurred_on)
// via PostgREST .gte()/.lte() — the query never round-trips through a JS
// `Date`, so there is no local-timezone conversion for a boundary payment
// to fall through. This is deliberately the same "stay in the string
// domain" discipline invoice_payments' own paid_on check constraint uses
// (`paid_on <= current_date + 1`, a Postgres-side comparison, not a JS one).
//
// `yearOfCalendarDate` below is the one place this file DOES need to read a
// year back out of a date value in JS (building the "available tax years"
// list from data already in memory). It uses lib/format.ts's
// `parseCalendarDate` — which parses "YYYY-MM-DD" as UTC midnight — and
// reads the year back with `.getUTCFullYear()`, never `.getFullYear()`.
// `.getFullYear()` reads the SERVER PROCESS's local zone: west of
// Greenwich (e.g. TZ=Pacific/Honolulu, UTC-10), UTC midnight on
// "2027-01-01" is still "2026-12-31 14:00" locally, and `.getFullYear()`
// would report 2026 for a payment that is unambiguously a 2027 one. This
// exact bug class was just fixed elsewhere in this product per the task
// brief; nothing in this file may reintroduce it.
// ---------------------------------------------------------------------------

export function yearBounds(year: number): { start: string; end: string } {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function yearOfCalendarDate(iso: string): number | null {
  const date = parseCalendarDate(iso);
  return date ? date.getUTCFullYear() : null;
}

/**
 * "Today" for picking the default report year. `getUTCFullYear()`, not
 * `getFullYear()` — the default view should not depend on the server
 * process's local zone either, even though (unlike the paid_on boundary
 * above) getting this one wrong for a few hours a year is a UX nit, not a
 * ledger-correctness bug.
 */
export function currentTaxYear(): number {
  return new Date().getUTCFullYear();
}

/**
 * The STOCK category labels — now derived from the one vocabulary
 * (lib/custom-options.ts's BUILTIN_OPTIONS) rather than retyped here, so
 * this map cannot fall behind the CHECK constraint again. It did once:
 * the self-funded categories fell through to the raw key, and before they
 * existed at all they were filed as "other", so the largest line on the
 * report a pilot hands their accountant could literally read "Other".
 * Recurrent training alone is commonly a freelance pilot's biggest annual
 * deduction.
 *
 * This stays the FALLBACK. The report screens and their exports resolve
 * labels through lib/custom-options-read.ts, so a tenant who renamed a
 * category sees their own word on the P&L, the quarterly and the
 * year-end pack as well as on the expenses list.
 */
export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  BUILTIN_OPTIONS.expense_category.map((option) => [option.value, option.label])
);
