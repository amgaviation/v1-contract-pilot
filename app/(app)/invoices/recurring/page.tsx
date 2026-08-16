import { LAlert, LCard } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";

import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { friendlyDbError } from "@/lib/db-errors";
import { YOU_INVOICE_COLUMN } from "@/lib/counterparty";
import type { Database } from "@/lib/supabase/database.types";
import ScheduleManager from "./schedule-form";
import DueQueue, { type DueRow } from "./due-queue";
import { computeDuePeriods } from "./actions";

export const metadata = { title: "Recurring invoices" };

type ScheduleRow = Database["pilot"]["Tables"]["recurring_invoice_schedules"]["Row"];
type GenerationRow = Pick<
  Database["pilot"]["Tables"]["recurring_invoice_generations"]["Row"],
  "schedule_id" | "period_start"
>;

export default async function RecurringInvoicesPage() {
  await requireEntitlement("recurring_invoices", "/invoices/recurring");
  const supabase = await createClient();

  const [
    { data: scheduleData, error: scheduleError },
    { data: generationData, error: generationError },
    { data: clientData, error: clientError },
  ] = await Promise.all([
    supabase
      .from("recurring_invoice_schedules")
      .select(
        "id, account_id, client_id, cadence, anchor_date, end_date, description, amount_cents, tax_rate_bps, active, created_at, updated_at"
      )
      .order("created_at", { ascending: false }),
    supabase.from("recurring_invoice_generations").select("schedule_id, period_start"),
    // 20260815120000: a schedule is a standing instruction to generate
    // invoices, so the picker offers only counterparties the pilot bills.
    supabase
      .from("clients")
      .select("id, name")
      .eq(YOU_INVOICE_COLUMN, true)
      .order("name", { ascending: true }),
  ]);

  const firstError = scheduleError ?? generationError ?? clientError;

  const schedules = (scheduleData ?? []) as ScheduleRow[];
  const clients = ((clientData ?? []) as { id: string; name: string }[]).map((c) => ({
    id: c.id,
    name: c.name,
  }));
  const clientNames = new Map(clients.map((c) => [c.id, c.name]));

  // Resolved in memory rather than a PostgREST embed — same reason as
  // every other list page in this app (see invoices/page.tsx): the embed's
  // return type resolves to `never` against the hand-authored types file.
  const generationsBySchedule = new Map<string, Set<string>>();
  for (const g of (generationData ?? []) as GenerationRow[]) {
    if (!generationsBySchedule.has(g.schedule_id)) generationsBySchedule.set(g.schedule_id, new Set());
    generationsBySchedule.get(g.schedule_id)!.add(g.period_start);
  }

  // The due queue is computed HERE, on every page load, from the schedule
  // + ledger rows — never stored. See the migration file header: there is
  // no background job populating a "due invoices" table, so this is the
  // one and only place "what's due" is decided, and it's decided fresh
  // every time the page renders.
  const today = new Date().toISOString().slice(0, 10);
  const dueRows: DueRow[] = [];
  for (const schedule of schedules) {
    if (!schedule.active) continue;
    const generated = generationsBySchedule.get(schedule.id) ?? new Set<string>();
    const due = await computeDuePeriods(schedule, generated, today);
    for (const d of due) {
      dueRows.push({
        ...d,
        client_name: clientNames.get(schedule.client_id) ?? "—",
        description: schedule.description,
      });
    }
  }
  dueRows.sort((a, b) => a.due_on.localeCompare(b.due_on));

  return (
    <LPageShell
      title="Recurring invoices"
      subtitle={
        firstError
          ? "Some figures below couldn't load. See the notice."
          : `${schedules.length} schedule${schedules.length === 1 ? "" : "s"}`
      }
    >
      {firstError ? (
        <LCard>
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>{friendlyDbError(firstError, "recurring.select")}</span>
          </LAlert>
        </LCard>
      ) : (
        <div className="flex flex-col gap-4">
          <DueQueue rows={dueRows} hasActiveSchedules={schedules.some((s) => s.active)} />
          <ScheduleManager schedules={schedules} clients={clients} />
        </div>
      )}
    </LPageShell>
  );
}

/* ── Inline icon ───────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. Same shape as overview/page.tsx's own WarningIcon. */
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
