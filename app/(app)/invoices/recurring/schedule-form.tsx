"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import NextLink from "next/link";
import { LAlert, LButton, LCard, LEmpty, LPill, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { LDialog } from "@/components/ledger/dialog";
import { LField, LInput, LSelect } from "@/components/ledger/forms";
import { centsToInput, formatCents, formatDate } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";
import {
  createRecurringSchedule,
  updateRecurringSchedule,
  setRecurringScheduleActive,
  setRecurringScheduleAutopay,
  deleteRecurringSchedule,
  type ScheduleFormState,
  type ScheduleEditState,
} from "./actions";

type ScheduleRow = Database["pilot"]["Tables"]["recurring_invoice_schedules"]["Row"];
export type ClientOption = {
  id: string;
  name: string;
  /** "Visa •••• 4242" when the client has enrolled in autopay, else null. */
  autopayLabel: string | null;
};

const CADENCE_LABEL: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly" };

/** cents → the percent string a tax_rate_percent field shows ("825" → "8.25"). */
function bpsToPercentInput(bps: number): string {
  return bps === 0 ? "" : (bps / 100).toFixed(2).replace(/\.?0+$/, "");
}

const emptyCreateState: ScheduleFormState = { error: null, values: {} };
const emptyEditState: ScheduleEditState = { error: null };

/** `min` for the anchor_date input — a soft nudge, not a real bound (the
 * server never enforces this; see the input's own comment). Computed at
 * module load, not per-render, since it only needs day granularity. */
const FIVE_YEARS_AGO = (() => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 5);
  return d.toISOString().slice(0, 10);
})();

function AddScheduleCard({ clients }: { clients: ClientOption[] }) {
  const [state, formAction, pending] = useActionState(createRecurringSchedule, emptyCreateState);
  const v = state.values ?? {};
  // React 19 resets an uncontrolled form on every dispatch, error path
  // included — remounting the whole field block on the echoed values
  // (via `key`) picks up a rejected submission's text instead of losing
  // it, same pattern as expenses/mileage/mileage-form.tsx's AddEntryCard.
  const [clientId, setClientId] = useState(v.client_id ?? "");
  const [cadence, setCadence] = useState(v.cadence || "monthly");

  return (
    <LCard>
      <form action={formAction} key={JSON.stringify(v)}>
        <h2 className="mb-3 text-h3 font-semibold">New recurring schedule</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <input type="hidden" name="client_id" value={clientId} />
          <LField label="Client" htmlFor="new-client">
            <LSelect
              id="new-client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="" disabled>
                Choose a client
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </LSelect>
          </LField>

          <input type="hidden" name="cadence" value={cadence} />
          <LField label="Cadence" htmlFor="new-cadence">
            <LSelect id="new-cadence" value={cadence} onChange={(e) => setCadence(e.target.value)}>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </LSelect>
          </LField>

          <LField
            label="First bill date"
            htmlFor="new-anchor"
            hint="A date further in the past can queue up many months of due invoices at once."
          >
            <LInput
              id="new-anchor"
              type="date"
              name="anchor_date"
              required
              // Helps the honest mistake only — a deliberately backdated
              // anchor still passes server-side (isDate is the real
              // validation; see actions.ts). The real guard against a
              // large backlog materializing in one click is the
              // create-all confirmation threshold in
              // generateAllDueRecurringInvoices (defect 7).
              min={FIVE_YEARS_AGO}
              defaultValue={v.anchor_date ?? ""}
            />
          </LField>

          <LField label="End date (optional)" htmlFor="new-end">
            <LInput id="new-end" type="date" name="end_date" defaultValue={v.end_date ?? ""} />
          </LField>

          <LField label="Amount billed" htmlFor="new-amount">
            <LInput
              id="new-amount"
              name="amount"
              required
              inputMode="decimal"
              placeholder="5000.00"
              defaultValue={v.amount ?? ""}
              className="tnum-l"
            />
          </LField>

          <LField label="Tax rate % (optional)" htmlFor="new-tax">
            <LInput
              id="new-tax"
              name="tax_rate_percent"
              inputMode="decimal"
              placeholder="0"
              defaultValue={v.tax_rate_percent ?? ""}
              className="tnum-l"
            />
          </LField>

          <LField
            label="Description (appears on the invoice line)"
            htmlFor="new-description"
            className="md:col-span-3"
          >
            <LInput
              id="new-description"
              name="description"
              required
              placeholder="Monthly retainer"
              defaultValue={v.description ?? ""}
            />
          </LField>
        </div>

        <div className="mt-3" role="alert" aria-live="polite">
          {state.error ? <p className="text-caption text-crit">{state.error}</p> : null}
        </div>
        <div className="mt-3">
          <LButton type="submit" disabled={pending}>
            {pending ? "Saving…" : "Add schedule"}
          </LButton>
        </div>
      </form>
    </LCard>
  );
}

function EditScheduleRow({ schedule, onDone }: { schedule: ScheduleRow; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(updateRecurringSchedule, emptyEditState);
  const v = state.values ?? {
    end_date: schedule.end_date ?? "",
    description: schedule.description,
    amount: centsToInput(schedule.amount_cents),
    tax_rate_percent: bpsToPercentInput(schedule.tax_rate_bps),
  };

  return (
    <tr>
      <LTd colSpan={6}>
        <form action={formAction} key={JSON.stringify(v)}>
          <input type="hidden" name="id" value={schedule.id} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <LField label="Description" htmlFor={`edit-desc-${schedule.id}`}>
              <LInput
                id={`edit-desc-${schedule.id}`}
                name="description"
                required
                defaultValue={v.description}
              />
            </LField>
            <LField label="Amount" htmlFor={`edit-amount-${schedule.id}`}>
              <LInput
                id={`edit-amount-${schedule.id}`}
                name="amount"
                required
                inputMode="decimal"
                defaultValue={v.amount}
                className="tnum-l"
              />
            </LField>
            <LField label="Tax rate %" htmlFor={`edit-tax-${schedule.id}`}>
              <LInput
                id={`edit-tax-${schedule.id}`}
                name="tax_rate_percent"
                inputMode="decimal"
                defaultValue={v.tax_rate_percent}
                className="tnum-l"
              />
            </LField>
            <LField label="End date" htmlFor={`edit-end-${schedule.id}`}>
              <LInput
                id={`edit-end-${schedule.id}`}
                type="date"
                name="end_date"
                defaultValue={v.end_date}
              />
            </LField>
          </div>
          <div className="mt-2" role="alert" aria-live="polite">
            {state.error ? <p className="text-caption text-crit">{state.error}</p> : null}
          </div>
          <div className="mt-3 flex gap-2">
            <LButton type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </LButton>
            <LButton type="button" size="sm" variant="outline" onClick={onDone}>
              Cancel
            </LButton>
          </div>
        </form>
      </LTd>
    </tr>
  );
}

function ScheduleRowView({
  schedule,
  clientName,
  editing,
  autopayLabel,
  onEdit,
  onDone,
}: {
  schedule: ScheduleRow;
  clientName: string;
  /** The client's enrolled-card label, or null when not enrolled. */
  autopayLabel: string | null;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Same reasoning as due-queue.tsx's own create-all confirm: focus opens
  // on Cancel, not the destructive Delete, so an Enter already in flight
  // when the dialog opens does not confirm the deletion.
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmOpen) cancelRef.current?.focus();
  }, [confirmOpen]);

  function handleToggle() {
    startTransition(async () => {
      setToggleError(null);
      const result = await setRecurringScheduleActive(schedule.id, !schedule.active);
      if (result.error) setToggleError(result.error);
    });
  }

  function handleAutopayToggle() {
    startTransition(async () => {
      setToggleError(null);
      const result = await setRecurringScheduleAutopay(schedule.id, !schedule.autopay);
      if (result.error) setToggleError(result.error);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      setDeleteError(null);
      const result = await deleteRecurringSchedule(schedule.id);
      if (result.error) setDeleteError(result.error);
      else setConfirmOpen(false);
    });
  }

  if (editing) {
    return <EditScheduleRow schedule={schedule} onDone={onDone} />;
  }

  return (
    <tr>
      {/* scope="row": the accessible-name row header Radix's
          Table.RowHeaderCell gave this cell. */}
      <th
        scope="row"
        className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
      >
        {clientName}
      </th>
      <LTd>
        <span className="text-ink-2">{schedule.description}</span>
      </LTd>
      <LTd>
        <span className="text-ink-2">{CADENCE_LABEL[schedule.cadence] ?? schedule.cadence}</span>
      </LTd>
      <LTd numeric>
        <span className="font-medium">{formatCents(schedule.amount_cents)}</span>
      </LTd>
      <LTd>
        <span className="text-ink-2">
          {formatDate(schedule.anchor_date)}
          {schedule.end_date ? ` to ${formatDate(schedule.end_date)}` : ""}
        </span>
      </LTd>
      <LTd>
        <div className="flex flex-wrap items-center gap-2">
          {schedule.active ? <LPill tone="good">Active</LPill> : <LPill tone="neutral">Paused</LPill>}
          {/* The autopay pill states which of the three states this
              schedule is actually in: off, on-and-armed (client enrolled,
              card named), or on-but-waiting (flag set, no card saved yet —
              generation still produces an ordinary draft until there is). */}
          {schedule.autopay ? (
            autopayLabel ? (
              <LPill tone="accent">{`Autopay · ${autopayLabel}`}</LPill>
            ) : (
              <LPill tone="warn">Autopay · client hasn&rsquo;t saved a card</LPill>
            )
          ) : null}
          <LButton type="button" variant="outline" size="sm" onClick={handleToggle} disabled={pending}>
            {schedule.active ? "Pause" : "Resume"}
          </LButton>
          <LButton type="button" variant="outline" size="sm" onClick={handleAutopayToggle} disabled={pending}>
            {schedule.autopay ? "Autopay off" : "Autopay on"}
          </LButton>
          <LButton type="button" variant="outline" size="sm" onClick={onEdit} disabled={pending}>
            Edit
          </LButton>
          <LButton
            type="button"
            variant="quiet"
            size="sm"
            className="text-crit hover:text-crit"
            onClick={() => setConfirmOpen(true)}
            disabled={pending}
          >
            Delete
          </LButton>
          <LDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Delete this schedule?"
            description={
              <>
                {`${clientName}, ${schedule.description} (${formatCents(schedule.amount_cents)} ${CADENCE_LABEL[schedule.cadence]?.toLowerCase()}). Invoices already created from it are unaffected; this only stops future ones.`}
                {deleteError ? (
                  <span className="mt-2 block text-caption font-medium text-crit" role="alert">
                    {deleteError}
                  </span>
                ) : null}
              </>
            }
            footer={
              <>
                <LButton
                  ref={cancelRef}
                  type="button"
                  variant="quiet"
                  disabled={pending}
                  onClick={() => setConfirmOpen(false)}
                >
                  Cancel
                </LButton>
                <LButton type="button" variant="danger" disabled={pending} onClick={handleDelete}>
                  {pending ? "Deleting…" : "Delete"}
                </LButton>
              </>
            }
          />
        </div>
        {toggleError ? <p className="mt-1 text-caption text-crit">{toggleError}</p> : null}
      </LTd>
    </tr>
  );
}

export default function ScheduleManager({
  schedules,
  clients,
}: {
  schedules: ScheduleRow[];
  clients: ClientOption[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const clientNames = new Map(clients.map((c) => [c.id, c.name]));
  const clientAutopay = new Map(clients.map((c) => [c.id, c.autopayLabel]));

  return (
    <div className="flex flex-col gap-4">
      <LAlert tone="accent" className="flex items-start gap-2">
        <InfoIcon className="mt-0.5 shrink-0 text-accent" />
        <span>
          A schedule records a cadence and never sends anything itself: each
          due invoice is created as a draft you review before sending. The one
          exception is autopay: if the client has saved a card, creating the
          due invoice also issues and charges it.
        </span>
      </LAlert>

      {clients.length === 0 ? (
        <LCard>
          <LEmpty
            title="Add a client first"
            action={
              <NextLink href="/clients/new" className={lButtonClass({ variant: "primary" })}>
                Add a client
              </NextLink>
            }
            secondaryAction={
              <NextLink href="/invoices/new" className={lButtonClass({ variant: "outline" })}>
                Raise a one-off invoice
              </NextLink>
            }
          >
            A schedule bills one client: an owner or operator on a retainer or
            committed-rate contract. A one-off invoice needs no client at all.
          </LEmpty>
        </LCard>
      ) : (
        <AddScheduleCard clients={clients} />
      )}

      <LCard>
        {schedules.length === 0 ? (
          <LEmpty
            title="No recurring schedules yet"
            action={
              clients.length === 0 ? (
                <NextLink href="/clients/new" className={lButtonClass({ variant: "outline" })}>
                  Add a client
                </NextLink>
              ) : (
                <NextLink href="/invoices" className={lButtonClass({ variant: "outline" })}>
                  Back to invoices
                </NextLink>
              )
            }
          >
            {`A schedule is for billing that repeats: a monthly retainer or a
            committed-rate contract. Every invoice it creates is a draft you
            review before sending.${
              clients.length === 0
                ? " Add a client above and this list fills in from there."
                : " Add one above and the periods it owes you show up in the queue at the top of this screen."
            }`}
          </LEmpty>
        ) : (
          <LTable>
            <caption>
              <span className="sr-only">Recurring schedules</span>
            </caption>
            <thead>
              <tr>
                <LTh>Client</LTh>
                <LTh>Description</LTh>
                <LTh>Cadence</LTh>
                <LTh numeric>Amount</LTh>
                <LTh>Term</LTh>
                <LTh>Status</LTh>
              </tr>
            </thead>
            <tbody>
              {schedules.map((schedule) => (
                <ScheduleRowView
                  key={schedule.id}
                  schedule={schedule}
                  clientName={clientNames.get(schedule.client_id) ?? "—"}
                  autopayLabel={clientAutopay.get(schedule.client_id) ?? null}
                  editing={editingId === schedule.id}
                  onEdit={() => setEditingId(schedule.id)}
                  onDone={() => setEditingId(null)}
                />
              ))}
            </tbody>
          </LTable>
        )}
      </LCard>
    </div>
  );
}

/* ── Inline icon ───────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. */
function InfoIcon({ className }: { className?: string }) {
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
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v4" />
      <circle cx="8" cy="4.9" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
