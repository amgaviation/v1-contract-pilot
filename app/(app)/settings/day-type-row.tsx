"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { LButton, LCard, LSwitch } from "@/components/ledger";
import { LField, LInput, LSelect } from "@/components/ledger/forms";
import { LConfirmDialog } from "@/components/ledger/dialog";
import { cn } from "@/lib/ledger/cn";
import { centsToInput } from "@/lib/format";
import { unitsToInput } from "@/app/(app)/trips/day-utils";
import type { Database } from "@/lib/supabase/database.types";
import {
  updateDayType,
  setDayTypeArchived,
  deleteDayType,
  type DayTypeFormState,
} from "./day-types-actions";

type DayTypeRowValue = Database["pilot"]["Tables"]["day_types"]["Row"];

const initialState: DayTypeFormState = { error: null };

const LINE_TYPE_OPTIONS = [
  { value: "flight_day", label: "Flight day line" },
  { value: "travel_day", label: "Travel day line" },
  { value: "other", label: "Other line" },
] as const;

/**
 * One day type, editable in place. Save/rename/rate/bills-as/order share
 * a single form; archive and delete are separate immediate actions (not
 * form fields), each with its own pending state, so a slow archive click
 * can't be confused with a slow save.
 */
export default function DayTypeRow({
  dayType,
  canEdit,
}: {
  dayType: DayTypeRowValue;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateDayType, initialState);
  const [archiving, startArchive] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteDialogError, setDeleteDialogError] = useState<string | null>(null);

  function handleDelete() {
    startDelete(async () => {
      setDeleteDialogError(null);
      setRowError(null);
      const result = await deleteDayType(dayType.id);
      if (result.error) {
        setDeleteDialogError(result.error);
        setRowError(result.error);
      } else {
        setConfirmDeleteOpen(false);
      }
    });
  }

  // F7: the action returns `requiresConfirm` instead of saving when
  // billable/invoice_line_type changed and un-invoiced trips already use
  // this type. The hidden field below flips to "1" once that happens, so
  // the SAME form's next Save actually applies the change — no separate
  // dialog or extra client state needed, `state` already persists across
  // the two dispatches.
  const awaitingConfirm = Boolean(state.requiresConfirm);

  // React 19 resets an uncontrolled form on every action dispatch, error
  // path included — echo what was submitted so a rejected save doesn't
  // blank the rename the pilot just typed.
  const submitted = state.values;
  const initial = (key: string, stored: unknown, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    return stored === null || stored === undefined ? fallback : String(stored);
  };
  const checked = (key: "billable" | "counts_for_per_diem", stored: boolean) => {
    const echoed = submitted?.[key];
    return echoed === undefined ? stored : echoed === "on";
  };

  const archived = Boolean(dayType.archived_at);

  // LSelect wraps a REAL <select>, but the same fix day-type-row's
  // predecessor needed still applies: React 19's post-action form.reset()
  // restores every control in the form to its mount-time state on EVERY
  // dispatch, error path included, and a controlled `value` with no
  // `name` on the select itself can't be trusted to survive that — so the
  // select stays name-less and controlled for display, and the actual
  // posted value rides a controlled hidden input instead.
  const [invoiceLineType, setInvoiceLineType] = useState(() =>
    initial("invoice_line_type", dayType.invoice_line_type)
  );
  useEffect(() => {
    if (submitted?.invoice_line_type !== undefined) {
      setInvoiceLineType(String(submitted.invoice_line_type));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  const billsAsId = `bills-as-${dayType.id}`;

  return (
    <LCard>
      <form action={formAction}>
        <div className="flex flex-col gap-3">
          <input type="hidden" name="id" value={dayType.id} />
          <input type="hidden" name="confirm_reprice" value={awaitingConfirm ? "1" : ""} />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-caption font-bold uppercase tracking-wide text-ink-3">
              {dayType.is_builtin ? "Starting day type" : "Custom day type"}
            </p>
            {archived ? (
              <p className="text-caption text-ink-3">
                Archived. Hidden from pickers, but still used on past trips
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-12">
            <LField label="Label" htmlFor={`label-${dayType.id}`} className="md:col-span-3">
              <LInput
                id={`label-${dayType.id}`}
                name="label"
                required
                disabled={!canEdit}
                defaultValue={initial("label", dayType.label)}
              />
            </LField>

            <div className="flex items-center gap-2 md:col-span-2 md:self-end md:pb-2">
              <LSwitch
                name="billable"
                value="on"
                disabled={!canEdit}
                defaultChecked={checked("billable", dayType.billable)}
                aria-label="Billable"
              />
              <span className="text-body-s text-ink-2">Billable</span>
            </div>

            <div className="flex items-center gap-2 md:col-span-3 md:self-end md:pb-2">
              <LSwitch
                name="counts_for_per_diem"
                value="on"
                disabled={!canEdit}
                defaultChecked={checked("counts_for_per_diem", dayType.counts_for_per_diem)}
                aria-label="Counts for per diem"
              />
              <span className="text-body-s text-ink-2">Counts for per diem</span>
            </div>

            <LField
              label="Default rate (USD)"
              htmlFor={`rate-${dayType.id}`}
              hint="Blank = no rate agreed"
              className="md:col-span-2"
            >
              <LInput
                id={`rate-${dayType.id}`}
                name="default_rate"
                inputMode="decimal"
                disabled={!canEdit}
                className="tnum-l"
                defaultValue={initial("default_rate", centsToInput(dayType.default_rate_cents))}
              />
            </LField>

            <LField
              label="Default rate fraction"
              htmlFor={`units-${dayType.id}`}
              hint="0.5 = half rate. Blank = full rate"
              className="md:col-span-2"
            >
              <LInput
                id={`units-${dayType.id}`}
                name="default_units"
                inputMode="decimal"
                placeholder="1"
                disabled={!canEdit}
                className="tnum-l"
                defaultValue={initial(
                  "default_units",
                  dayType.default_units === null ? "" : unitsToInput(dayType.default_units)
                )}
              />
            </LField>

            <LField
              label="Order"
              htmlFor={`order-${dayType.id}`}
              hint="Lower shows first"
              className="md:col-span-2"
            >
              <LInput
                id={`order-${dayType.id}`}
                type="number"
                name="sort_order"
                disabled={!canEdit}
                className="tnum-l"
                defaultValue={initial("sort_order", dayType.sort_order)}
              />
            </LField>

            <LField label="Bills as" htmlFor={billsAsId} className="md:col-span-5">
              <LSelect
                id={billsAsId}
                disabled={!canEdit}
                value={invoiceLineType}
                onChange={(e) => setInvoiceLineType(e.target.value)}
              >
                {LINE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </LSelect>
              <input type="hidden" name="invoice_line_type" value={invoiceLineType} />
            </LField>
            <div className="flex flex-col justify-center md:col-span-7">
              <p className="text-body-s text-ink-3">
                The name is yours to change. Which invoice line it bills as is fixed, because the
                invoice&rsquo;s own billing rules depend on it.
              </p>
            </div>
          </div>

          <div role="alert" aria-live="polite">
            {state.error ? (
              <p className="text-caption font-medium text-crit">{state.error}</p>
            ) : awaitingConfirm ? (
              // F7: not saved yet — naming the consequence rather than
              // blocking it. Save again (the hidden confirm_reprice field is
              // now "1") to apply the change anyway.
              <p className="text-caption font-medium text-warn">
                Changing Billable or Bills as will change how already-recorded days bill on{" "}
                {state.affectedTripCount}{" "}
                {state.affectedTripCount === 1 ? "trip that hasn't" : "trips that haven't"} been
                invoiced yet. Save again to apply it anyway.
              </p>
            ) : state.saved ? (
              <p className="text-caption font-medium text-good">Saved.</p>
            ) : null}
            {rowError ? <p className="text-caption font-medium text-crit">{rowError}</p> : null}
          </div>

          {canEdit ? (
            <div className="flex flex-wrap gap-3">
              <LButton type="submit" size="sm" disabled={pending}>
                {pending ? "Saving…" : awaitingConfirm ? "Save anyway" : "Save"}
              </LButton>
              <LButton
                type="button"
                variant="outline"
                size="sm"
                disabled={archiving}
                className={cn(!archived && "border-warn text-warn hover:bg-warn-soft")}
                onClick={() =>
                  startArchive(async () => {
                    setRowError(null);
                    const result = await setDayTypeArchived(dayType.id, !archived);
                    setRowError(result.error);
                  })
                }
              >
                {archiving ? "Working…" : archived ? "Restore" : "Archive"}
              </LButton>
              {/* F1: never offer Delete on a built-in row — Archive/Restore
                  already do everything a pilot actually wants here, and
                  unlike delete it's reversible. The database rejects a
                  built-in delete outright (23514), but the control shouldn't
                  exist to invite trying. */}
              {dayType.is_builtin ? null : (
                <LButton
                  type="button"
                  variant="quiet"
                  size="sm"
                  disabled={deleting}
                  className="text-crit hover:bg-crit-soft"
                  onClick={() => setConfirmDeleteOpen(true)}
                >
                  {deleting ? "Deleting…" : "Delete"}
                </LButton>
              )}
            </div>
          ) : null}
        </div>
      </form>

      {/* Rendered OUTSIDE the form above, deliberately: LConfirmDialog's own
          Cancel/Confirm buttons carry no explicit `type`, so a native
          `<button>` with none defaults to type="submit" — nested inside
          this row's own <form>, either button would have silently
          submitted the day-type edit form instead of (or in addition to)
          running its own handler. `<dialog>`/showModal() positions itself
          from the top layer, not from its DOM parent, so moving it outside
          the form costs nothing visually. */}
      {dayType.is_builtin ? null : (
        <LConfirmDialog
          open={confirmDeleteOpen}
          onOpenChange={setConfirmDeleteOpen}
          title={`Delete "${dayType.label}"?`}
          description={
            <>
              <p>
                This deletes the day type. Any client rate overrides set for it go too. This
                can&rsquo;t be undone. (A day type in use on a trip, or a built-in type,
                can&rsquo;t be deleted. Archive it instead.)
              </p>
              {deleteDialogError ? (
                <p className="mt-2 text-caption font-medium text-crit" role="alert">
                  {deleteDialogError}
                </p>
              ) : null}
            </>
          }
          confirmLabel="Delete day type"
          onConfirm={handleDelete}
          pending={deleting}
        />
      )}
    </LCard>
  );
}
