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
 * period_start) constraint on recurring_invoice_generations.
 *
 * DEFECT 6 FIX (20260809050000): this used to write invoice -> line ->
 * ledger as three separate statements. Any failure after the invoice
 * insert — a line-insert failure, a ledger-insert failure on anything but
 * 23505, or even a ledger-insert failure WITH 23505 (the friendly-message
 * path) — left a real orphaned invoice (and possibly line) behind with
 * nothing to clean it up, and in the non-23505 cases the period stayed
 * "due" so every retry compounded the mess. The write is now a single
 * call to pilot.generate_recurring_invoice (see
 * 20260809050000_mileage_and_recurring_fixes.sql), a SECURITY DEFINER
 * function that performs all three inserts as the effects of ONE
 * top-level statement: if the ledger's unique-constraint check fails
 * (23505) or anything else fails, Postgres rolls back the entire
 * statement's effects atomically — the invoice and line never persist
 * without their ledger row, and a losing concurrent caller leaves nothing
 * behind at all. See that migration's header for the rejected
 * alternative (a nullable ledger.invoice_id) and why it was rejected.
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
  // for THIS schedule (a public server action is a public endpoint). The
  // generate_recurring_invoice function does NOT re-check due-ness itself
  // (see its comment) — this is still the only place that happens.
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

  // `as never`: supabase-js's .rpc() resolves its args parameter to
  // `undefined` against this hand-authored types file for any function
  // that takes arguments — same quirk worked around identically at every
  // other .rpc() call site in this codebase (see trips/actions.ts's
  // comment on its trip_committed_invoice calls). The Args shape is still
  // compile-time checked via the Database["pilot"]["Functions"] entry the
  // cast target is defined against.
  const { data: invoiceId, error: generateError } = await supabase.rpc(
    "generate_recurring_invoice",
    { p_schedule_id: scheduleId, p_period_start: periodStart } as never
  );
  if (generateError) {
    if (generateError.code === "23505") {
      return { error: "This period was already created (possibly just now, in another tab)." };
    }
    return { error: friendlyDbError(generateError, "generate_recurring_invoice") };
  }

  revalidatePath("/invoices/recurring");
  revalidatePath("/invoices");
  return { error: null, invoiceId: invoiceId as string };
}

export type GenerateAllResult = {
  error: string | null;
  created: number;
  failed: string[];
  /**
   * True when the due set exceeds CREATE_ALL_CONFIRM_THRESHOLD and the
   * caller did NOT pass confirmed=true — nothing was created. The caller
   * (due-queue.tsx) shows dueCount/dueAmountCents in a confirmation dialog
   * and re-calls with confirmed=true to proceed.
   */
  needsConfirmation?: boolean;
  dueCount?: number;
  dueAmountCents?: number;
};

/**
 * DEFECT 7 FIX (20260809050000): a schedule anchored years in the past can
 * accumulate a large backlog of due periods (reviewer executed: anchor
 * 2020-01-15, monthly, today -> 79 due periods) well under
 * computeDuePeriods' own 600-period runaway guard, which exists only to
 * catch a corrupted anchor_date, not to protect against "Create all due"
 * materializing dozens of drafts in one click with no more warning than a
 * count. Past this threshold, generateAllDueRecurringInvoices requires an
 * explicit second call with confirmed=true — see due-queue.tsx for the
 * confirmation dialog that shows the count AND total amount before that
 * second call happens. Chosen at 12 (one year of a monthly schedule): the
 * common, unremarkable case (catching up a handful of missed months) sails
 * through with no friction; anything bigger gets a stop.
 *
 * NOT exported: a "use server" module may only export async functions —
 * Next.js enforces this at build time — so this stays module-private.
 * Callers (due-queue.tsx) never need the raw number; they read
 * dueCount/dueAmountCents off GenerateAllResult instead.
 */
const CREATE_ALL_CONFIRM_THRESHOLD = 12;

/**
 * Runs generateRecurringInvoice for every currently-due period across
 * every active schedule, SEQUENTIALLY (not Promise.all) — deliberately,
 * so each generation's own due-set recomputation sees the ledger rows the
 * previous one just wrote, rather than every call racing off the same
 * stale snapshot.
 */
export async function generateAllDueRecurringInvoices(
  confirmed = false
): Promise<GenerateAllResult> {
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
  const scheduleById = new Map(schedules.map((s) => [s.id, s]));

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

  if (targets.length > CREATE_ALL_CONFIRM_THRESHOLD && !confirmed) {
    const dueAmountCents = targets.reduce(
      (sum, t) => sum + (scheduleById.get(t.schedule_id)?.amount_cents ?? 0),
      0
    );
    return { error: null, created: 0, failed: [], needsConfirmation: true, dueCount: targets.length, dueAmountCents };
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
