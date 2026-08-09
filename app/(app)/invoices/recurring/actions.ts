"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { parseDollarsToCents } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";

type ScheduleRow = Database["pilot"]["Tables"]["recurring_invoice_schedules"]["Row"];
type ScheduleInsert = Database["pilot"]["Tables"]["recurring_invoice_schedules"]["Insert"];
type ScheduleUpdate = Database["pilot"]["Tables"]["recurring_invoice_schedules"]["Update"];
type GenerationInsert = Database["pilot"]["Tables"]["recurring_invoice_generations"]["Insert"];
type InvoiceInsert = Database["pilot"]["Tables"]["invoices"]["Insert"];
type LineInsert = Database["pilot"]["Tables"]["invoice_lines"]["Insert"];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function optional(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

/**
 * A tax percent input to the basis-points integer the column stores.
 * Copied from invoices/actions.ts's own parsePercentToBps rather than
 * imported — that function isn't exported, and this migration's mandate
 * is expressly not to fork/edit that file. Same bound (0-25%) as
 * pilot.invoices.tax_rate_bps / recurring_invoice_schedules.tax_rate_bps.
 */
function parsePercentToBps(raw: string): number | null | undefined {
  const value = raw.trim();
  if (value === "") return null;
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(value)) return undefined;
  const bps = Math.round(Number(value) * 100);
  if (!Number.isFinite(bps) || bps < 0 || bps > 2500) return undefined;
  return bps;
}

// ---------------------------------------------------------------------------
// PERIOD ARITHMETIC — calendar months only, no day counts. See the
// migration file header (20260809030000_recurring_invoices.sql) for the
// full reasoning; this is that decision's one implementation.
//
// A schedule's Nth period (N = 0, 1, 2, ...) is `cadence`'s step (1 month
// for monthly, 3 for quarterly) times N months after the anchor's own
// month. period_start is always the first of that calendar month — the
// value stored in recurring_invoice_generations.period_start and checked
// against its unique constraint. The period becomes DUE on a day within
// that month: the anchor's day-of-month, clamped to the last day of a
// shorter month (the 31st-in-a-30-day-month case — see the migration
// header for why clamping, not rolling into the next month, is correct
// here).
// ---------------------------------------------------------------------------

/** UTC-safe: every date here is a "YYYY-MM-DD" civil date, never a local Date. */
function ymd(y: number, m0: number, d: number): string {
  const dt = new Date(Date.UTC(y, m0, d));
  return dt.toISOString().slice(0, 10);
}

function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

function parseYmd(s: string): { y: number; m0: number; d: number } {
  const parts = s.split("-").map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return { y, m0: m - 1, d };
}

const CADENCE_STEP_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3 };

/**
 * The due-on date for a schedule's Nth period: the anchor's day-of-month,
 * clamped into that period's month.
 */
function periodDueDate(anchorDate: string, periodStart: string): string {
  const anchor = parseYmd(anchorDate);
  const period = parseYmd(periodStart);
  const clampedDay = Math.min(anchor.d, daysInMonth(period.y, period.m0));
  return ymd(period.y, period.m0, clampedDay);
}

export type DuePeriod = {
  schedule_id: string;
  period_start: string;
  due_on: string;
};

/**
 * Every period this schedule has ever become due for, up to and including
 * `today`, that is NOT already in `generatedPeriods` — the "due to
 * create" set the queue offers. A paused (active=false) schedule or one
 * past its own end_date is never asked here (callers filter before
 * calling, or pass an already-excluded set).
 *
 * Capped at 600 periods (50 years monthly, 150 years quarterly) purely as
 * a runaway guard against a corrupted anchor_date far in the past — no
 * real schedule approaches this.
 *
 * Declared `async` (despite being pure, synchronous date arithmetic)
 * because this file is a "use server" module and every export from one
 * must be an async function — Next.js enforces this at build time.
 * Callers therefore `await` a call that never actually suspends.
 */
export async function computeDuePeriods(
  schedule: Pick<ScheduleRow, "id" | "cadence" | "anchor_date" | "end_date">,
  generatedPeriods: ReadonlySet<string>,
  today: string
): Promise<DuePeriod[]> {
  const step = CADENCE_STEP_MONTHS[schedule.cadence] ?? 1;
  const anchor = parseYmd(schedule.anchor_date);
  const anchorAbsMonth = anchor.y * 12 + anchor.m0;

  const due: DuePeriod[] = [];
  for (let k = 0; k < 600; k++) {
    const absMonth = anchorAbsMonth + k * step;
    const periodY = Math.floor(absMonth / 12);
    const periodM0 = ((absMonth % 12) + 12) % 12;
    const periodStart = ymd(periodY, periodM0, 1);
    const dueOn = periodDueDate(schedule.anchor_date, periodStart);

    if (dueOn > today) break; // periods are monotonically increasing — done.
    if (schedule.end_date && dueOn > schedule.end_date) break;

    if (!generatedPeriods.has(periodStart)) {
      due.push({ schedule_id: schedule.id, period_start: periodStart, due_on: dueOn });
    }
  }
  return due;
}

// ---------------------------------------------------------------------------
// Schedule CRUD.
// ---------------------------------------------------------------------------

export type ScheduleFormState = {
  error: string | null;
  values?: Record<string, string>;
};

const SCHEDULE_FIELDS = [
  "client_id",
  "cadence",
  "anchor_date",
  "end_date",
  "description",
  "amount",
  "tax_rate_percent",
] as const;

function echoSchedule(formData: FormData) {
  const out: Record<string, string> = {};
  for (const field of SCHEDULE_FIELDS) out[field] = String(formData.get(field) ?? "");
  return out;
}

export async function createRecurringSchedule(
  _prev: ScheduleFormState,
  formData: FormData
): Promise<ScheduleFormState> {
  const { account } = await requireAccount("/invoices/recurring");
  const values = echoSchedule(formData);

  const clientId = String(formData.get("client_id") ?? "").trim();
  if (!UUID_RE.test(clientId)) {
    return { error: "Choose a client to bill.", values };
  }

  const cadence = String(formData.get("cadence") ?? "").trim();
  if (cadence !== "monthly" && cadence !== "quarterly") {
    return { error: "Choose monthly or quarterly.", values };
  }

  const anchorDate = String(formData.get("anchor_date") ?? "").trim();
  if (!isDate(anchorDate)) {
    return { error: "Enter a valid first-bill date.", values };
  }

  const endDate = optional(formData, "end_date");
  if (endDate !== null && !isDate(endDate)) {
    return { error: "The end date isn't valid.", values };
  }
  if (endDate !== null && endDate < anchorDate) {
    return { error: "The end date can't be before the first-bill date.", values };
  }

  const description = String(formData.get("description") ?? "").trim();
  if (!description) {
    return { error: "Describe what this bills (e.g. \"Monthly retainer\").", values };
  }

  const amountCents = parseDollarsToCents(String(formData.get("amount") ?? ""));
  if (amountCents === undefined || amountCents === null || amountCents <= 0) {
    return { error: "Enter a billed amount greater than $0.", values };
  }

  const taxBps = parsePercentToBps(String(formData.get("tax_rate_percent") ?? ""));
  if (taxBps === undefined) {
    return { error: "Tax rate must be a percent like 8.25, up to 25%.", values };
  }

  const supabase = await createClient();

  // Server-refetched, scoped to this tenant — never trust a submitted
  // client id belongs to this account (the composite FK would also
  // reject it, but this gives a clearer message).
  const { data: clientRow } = await supabase
    .from("clients")
    .select("id")
    .eq("account_id", account.id)
    .eq("id", clientId)
    .maybeSingle();
  if (!clientRow) {
    return { error: "That client couldn't be found.", values };
  }

  const payload: ScheduleInsert = {
    account_id: account.id,
    client_id: clientId,
    cadence,
    anchor_date: anchorDate,
    end_date: endDate,
    description,
    amount_cents: amountCents,
    tax_rate_bps: taxBps ?? 0,
  };

  const { error } = await supabase.from("recurring_invoice_schedules").insert(payload as never);
  if (error) {
    return { error: friendlyDbError(error, "recurring_invoice_schedules.insert"), values };
  }

  revalidatePath("/invoices/recurring");
  return { error: null, values: {} };
}

export type ScheduleEditValues = {
  end_date?: string;
  description?: string;
  amount?: string;
  tax_rate_percent?: string;
};
export type ScheduleEditState = { error: string | null; values?: ScheduleEditValues };

export async function updateRecurringSchedule(
  _prev: ScheduleEditState,
  formData: FormData
): Promise<ScheduleEditState> {
  const { account } = await requireAccount("/invoices/recurring");

  const id = String(formData.get("id") ?? "").trim();
  const values: ScheduleEditValues = {
    end_date: String(formData.get("end_date") ?? ""),
    description: String(formData.get("description") ?? ""),
    amount: String(formData.get("amount") ?? ""),
    tax_rate_percent: String(formData.get("tax_rate_percent") ?? ""),
  };
  if (!UUID_RE.test(id)) {
    return { error: "That schedule couldn't be found.", values };
  }

  const endDate = optional(formData, "end_date");
  if (endDate !== null && !isDate(endDate)) {
    return { error: "The end date isn't valid.", values };
  }

  const description = String(formData.get("description") ?? "").trim();
  if (!description) {
    return { error: "Describe what this bills.", values };
  }

  const amountCents = parseDollarsToCents(String(formData.get("amount") ?? ""));
  if (amountCents === undefined || amountCents === null || amountCents <= 0) {
    return { error: "Enter a billed amount greater than $0.", values };
  }

  const taxBps = parsePercentToBps(String(formData.get("tax_rate_percent") ?? ""));
  if (taxBps === undefined) {
    return { error: "Tax rate must be a percent like 8.25, up to 25%.", values };
  }

  const supabase = await createClient();
  const payload: ScheduleUpdate = {
    end_date: endDate,
    description,
    amount_cents: amountCents,
    tax_rate_bps: taxBps ?? 0,
  };

  const { error } = await supabase
    .from("recurring_invoice_schedules")
    .update(payload as never)
    .eq("account_id", account.id)
    .eq("id", id);
  if (error) {
    return { error: friendlyDbError(error, "recurring_invoice_schedules.update"), values };
  }

  revalidatePath("/invoices/recurring");
  return { error: null, values: {} };
}

/**
 * Pause/resume, and delete — both simple enough to be direct async
 * functions rather than useActionState forms (no fields to echo on
 * failure), same pattern as expenses/mileage/actions.ts's
 * deleteMileageEntry.
 */
export async function setRecurringScheduleActive(
  id: string,
  active: boolean
): Promise<{ error: string | null }> {
  const { account } = await requireAccount("/invoices/recurring");
  if (!UUID_RE.test(id)) return { error: "That schedule couldn't be found." };

  const supabase = await createClient();
  const payload: ScheduleUpdate = { active };
  const { error } = await supabase
    .from("recurring_invoice_schedules")
    .update(payload as never)
    .eq("account_id", account.id)
    .eq("id", id);
  if (error) return { error: friendlyDbError(error, "recurring_invoice_schedules.update") };

  revalidatePath("/invoices/recurring");
  return { error: null };
}

/**
 * Deleting a schedule stops it offering any further due periods. It does
 * NOT touch invoices already generated from it — those stand on their own
 * as ordinary invoices. It DOES delete this schedule's own
 * recurring_invoice_generations rows (ON DELETE CASCADE, by schedule_id) —
 * the idempotency history for a schedule that no longer exists has nothing
 * left to protect, since the schedule itself can never offer that period
 * again.
 */
export async function deleteRecurringSchedule(id: string): Promise<{ error: string | null }> {
  const { account } = await requireAccount("/invoices/recurring");
  if (!UUID_RE.test(id)) return { error: "That schedule couldn't be found." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("recurring_invoice_schedules")
    .delete()
    .eq("account_id", account.id)
    .eq("id", id);
  if (error) return { error: friendlyDbError(error, "recurring_invoice_schedules.delete") };

  revalidatePath("/invoices/recurring");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Generation — turns one due period into a DRAFT invoice. Never sends,
// never numbers it (invoice_number is assigned only on the pilot's own
// draft -> sent transition, same as every other invoice — see
// invoices_assign_number_on_issue in the Phase 5 migration). This is the
// ONLY place in this app that writes pilot.recurring_invoice_generations,
// and there is no scheduled job calling it — see the migration file
// header's "what this deliberately does not do" #1. It runs exclusively
// in response to an explicit pilot click (recurring/due-queue.tsx).
// ---------------------------------------------------------------------------

export type GenerateResult = { error: string | null; invoiceId?: string };

/**
 * Generates one invoice for one (schedule, period). Best-effort
 * pre-checked against recurring_invoice_generations before writing — the
 * same "check then insert, for a clearer message" pattern
 * createInvoiceDraft uses via trip_committed_invoice (invoices/actions.ts)
 * — but the REAL guard is the unique (account_id, schedule_id,
 * period_start) constraint on recurring_invoice_generations, which this
 * function relies on for correctness under a race (two concurrent clicks,
 * or "create all" racing a single "create"): if the ledger insert below
 * hits 23505, the period was already generated by the other caller and
 * this call reports the friendly "already created" message rather than
 * silently producing a second document.
 *
 * KNOWN RESIDUAL: the invoice + its lines are written in one step, THEN
 * the ledger row. A concurrent duplicate call can still create a second
 * DRAFT invoice for the same period before either ledger insert lands (a
 * true single-statement reservation would need invoice_id to be nullable
 * on the ledger, which would weaken the constraint's own guarantee that a
 * recorded generation always names a real invoice). That residual is
 * judged acceptable here specifically because the product's draft-confirm
 * rule means the worst outcome is two REVIEWABLE drafts, never two SENT
 * invoices — the pilot sees both before either becomes a real document,
 * and can delete the spare. It could not race to double-billing the way
 * a background job could.
 */
export async function generateRecurringInvoice(
  scheduleId: string,
  periodStart: string
): Promise<GenerateResult> {
  const { account } = await requireAccount("/invoices/recurring");
  if (!UUID_RE.test(scheduleId) || !isDate(periodStart)) {
    return { error: "That period couldn't be found." };
  }

  const supabase = await createClient();

  const { data: scheduleData, error: scheduleError } = await supabase
    .from("recurring_invoice_schedules")
    .select("id, client_id, cadence, anchor_date, end_date, description, amount_cents, tax_rate_bps, active")
    .eq("account_id", account.id)
    .eq("id", scheduleId)
    .maybeSingle();
  if (scheduleError) {
    return { error: friendlyDbError(scheduleError, "recurring_invoice_schedules.select") };
  }
  const schedule = scheduleData as ScheduleRow | null;
  if (!schedule) return { error: "That schedule couldn't be found." };
  if (!schedule.active) return { error: "This schedule is paused — resume it to create an invoice." };

  // Recompute the schedule's own due set server-side and require the
  // requested period to be a member of it — never trust a submitted
  // period_start's due-ness, only that it is a real, currently-due period
  // for THIS schedule (a public server action is a public endpoint).
  const { data: existingGenerations, error: genError } = await supabase
    .from("recurring_invoice_generations")
    .select("period_start")
    .eq("account_id", account.id)
    .eq("schedule_id", scheduleId);
  if (genError) {
    return { error: friendlyDbError(genError, "recurring_invoice_generations.select") };
  }
  const generatedSet = new Set(
    ((existingGenerations ?? []) as { period_start: string }[]).map((g) => g.period_start)
  );
  const today = new Date().toISOString().slice(0, 10);
  const due = await computeDuePeriods(schedule, generatedSet, today);
  if (!due.some((d) => d.period_start === periodStart)) {
    return { error: "That period isn't due to create (already generated, not yet due, or past the schedule's end date)." };
  }

  const invoicePayload: InvoiceInsert = {
    account_id: account.id,
    client_id: schedule.client_id,
    tax_rate_bps: schedule.tax_rate_bps,
  };
  const { data: invoiceData, error: invoiceError } = await supabase
    .from("invoices")
    .insert(invoicePayload as never)
    .select("id")
    .single();
  if (invoiceError) {
    return { error: friendlyDbError(invoiceError, "invoices.insert") };
  }
  const invoiceId = (invoiceData as { id: string }).id;

  const linePayload: LineInsert = {
    account_id: account.id,
    invoice_id: invoiceId,
    // 'other' — a recurring schedule bills a flat description + amount,
    // not a specific day-type or expense; there is no closer-fitting
    // line_type in the invoice_lines check constraint (see the Phase 5
    // migration's list).
    line_type: "other",
    description: schedule.description,
    quantity: 1,
    unit_amount_cents: schedule.amount_cents,
    taxable: true,
  };
  const { error: lineError } = await supabase.from("invoice_lines").insert(linePayload as never);
  if (lineError) {
    return { error: friendlyDbError(lineError, "invoice_lines.insert") };
  }

  const generationPayload: GenerationInsert = {
    account_id: account.id,
    schedule_id: scheduleId,
    period_start: periodStart,
    invoice_id: invoiceId,
  };
  const { error: ledgerError } = await supabase
    .from("recurring_invoice_generations")
    .insert(generationPayload as never);
  if (ledgerError) {
    if (ledgerError.code === "23505") {
      return { error: "This period was already created (possibly just now, in another tab)." };
    }
    return { error: friendlyDbError(ledgerError, "recurring_invoice_generations.insert") };
  }

  revalidatePath("/invoices/recurring");
  revalidatePath("/invoices");
  return { error: null, invoiceId };
}

export type GenerateAllResult = { error: string | null; created: number; failed: string[] };

/**
 * Runs generateRecurringInvoice for every currently-due period across
 * every active schedule, SEQUENTIALLY (not Promise.all) — deliberately,
 * so each generation's own due-set recomputation sees the ledger rows the
 * previous one just wrote, rather than every call racing off the same
 * stale snapshot.
 */
export async function generateAllDueRecurringInvoices(): Promise<GenerateAllResult> {
  const { account } = await requireAccount("/invoices/recurring");
  const supabase = await createClient();

  const { data: schedulesData, error: schedulesError } = await supabase
    .from("recurring_invoice_schedules")
    .select("id, client_id, cadence, anchor_date, end_date, description, amount_cents, tax_rate_bps, active")
    .eq("account_id", account.id)
    .eq("active", true);
  if (schedulesError) {
    return { error: friendlyDbError(schedulesError, "recurring_invoice_schedules.select"), created: 0, failed: [] };
  }
  const schedules = (schedulesData ?? []) as ScheduleRow[];

  const { data: generationsData, error: generationsError } = await supabase
    .from("recurring_invoice_generations")
    .select("schedule_id, period_start")
    .eq("account_id", account.id);
  if (generationsError) {
    return { error: friendlyDbError(generationsError, "recurring_invoice_generations.select"), created: 0, failed: [] };
  }
  const generationsBySchedule = new Map<string, Set<string>>();
  for (const g of (generationsData ?? []) as { schedule_id: string; period_start: string }[]) {
    if (!generationsBySchedule.has(g.schedule_id)) generationsBySchedule.set(g.schedule_id, new Set());
    generationsBySchedule.get(g.schedule_id)!.add(g.period_start);
  }

  const today = new Date().toISOString().slice(0, 10);
  const targets: DuePeriod[] = [];
  for (const schedule of schedules) {
    const generated = generationsBySchedule.get(schedule.id) ?? new Set<string>();
    targets.push(...(await computeDuePeriods(schedule, generated, today)));
  }

  let created = 0;
  const failed: string[] = [];
  for (const target of targets) {
    const result = await generateRecurringInvoice(target.schedule_id, target.period_start);
    if (result.error) failed.push(`${target.period_start}: ${result.error}`);
    else created += 1;
  }

  return { error: null, created, failed };
}
