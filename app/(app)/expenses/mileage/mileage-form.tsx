"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import NextLink from "next/link";
import { LAlert, LButton, LCard, LTable, LTd, LTh } from "@/components/ledger";
import { LConfirmDialog } from "@/components/ledger/dialog";
import { LField, LInput, LSelect, LTextarea } from "@/components/ledger/forms";
import { formatCents, formatDate } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";
import {
  createMileageEntry,
  updateMileageEntry,
  deleteMileageEntry,
  type MileageFormState,
} from "./actions";

type MileageEntryRow = Database["pilot"]["Tables"]["mileage_entries"]["Row"];

export type TripOption = { id: string; label: string };
export type ClientOption = { id: string; name: string };

/** Rates the pilot has recorded (Settings → Mileage), keyed by tax year. */
export type RatesByYear = Record<number, number>;

// These sentinels stand in for "none" and are translated back to "" on
// submit, same pattern as expense-form.tsx.
const NO_TRIP = "none";
const NO_CLIENT = "none";

const initialState: MileageFormState = { error: null };

function yearOf(dateStr: string): number | null {
  const y = Number(dateStr.slice(0, 4));
  return Number.isInteger(y) ? y : null;
}

/** cents-per-mile → a compact display string, trailing zeros trimmed. */
function formatRateForDisplay(rate: number): string {
  return rate.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Shared field set for both the add form and an in-place row edit. Not
 * exported — this file is the one interactive surface the mileage screen
 * gets (page.tsx and actions.ts are server-only), so the add form and the
 * per-row edit form share their markup here instead of duplicating it.
 */
function EntryFields({
  idPrefix,
  values,
  trips,
  clients,
  rates,
  disabled,
  rateLocked,
}: {
  idPrefix: string;
  values: {
    drove_on: string;
    miles: string;
    from_place: string;
    to_place: string;
    purpose: string;
    trip_id: string;
    client_id: string;
    rate_cents_per_mile: string;
    notes: string;
  };
  trips: TripOption[];
  clients: ClientOption[];
  rates: RatesByYear;
  disabled?: boolean;
  /**
   * True when editing an already-saved entry. The rate is snapshotted at
   * capture and, as of 20260809050000, genuinely immutable — the database
   * has no UPDATE grant on mileage_entries.rate_cents_per_mile for
   * `authenticated` at all. This renders the rate as read-only display
   * text with NO `name` attribute, so it is never submitted on an edit
   * (an update payload including it would be rejected with a permission
   * error rather than silently accepted). Correcting a wrong rate is
   * delete-and-recreate, the same discipline
   * recurring_invoice_schedules.client_id/cadence/anchor_date uses.
   */
  rateLocked?: boolean;
}) {
  const [droveOn, setDroveOn] = useState(values.drove_on);
  const [tripId, setTripId] = useState(values.trip_id === "" ? NO_TRIP : values.trip_id);
  const [clientId, setClientId] = useState(values.client_id === "" ? NO_CLIENT : values.client_id);
  const [rate, setRate] = useState(values.rate_cents_per_mile);

  const year = yearOf(droveOn);
  const yearRate = year !== null ? rates[year] : undefined;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      <input type="hidden" name="trip_id" value={tripId === NO_TRIP ? "" : tripId} />
      <input type="hidden" name="client_id" value={clientId === NO_CLIENT ? "" : clientId} />

      <LField label="Date" htmlFor={`${idPrefix}-drove_on`}>
        <LInput
          id={`${idPrefix}-drove_on`}
          type="date"
          name="drove_on"
          required
          disabled={disabled}
          value={droveOn}
          onChange={(e) => setDroveOn(e.target.value)}
        />
      </LField>
      <LField label="Miles" htmlFor={`${idPrefix}-miles`}>
        <LInput
          id={`${idPrefix}-miles`}
          name="miles"
          required
          inputMode="decimal"
          disabled={disabled}
          defaultValue={values.miles}
        />
      </LField>
      <LField label="From" htmlFor={`${idPrefix}-from`}>
        <LInput
          id={`${idPrefix}-from`}
          name="from_place"
          required
          placeholder="home"
          disabled={disabled}
          defaultValue={values.from_place}
        />
      </LField>
      <LField label="To" htmlFor={`${idPrefix}-to`}>
        <LInput
          id={`${idPrefix}-to`}
          name="to_place"
          required
          placeholder="KTEB"
          disabled={disabled}
          defaultValue={values.to_place}
        />
      </LField>

      <div className="md:col-span-4">
        <LField
          label="Purpose"
          htmlFor={`${idPrefix}-purpose`}
          hint="What the drive was for. This is the record that lets you (or your tax preparer) tell business driving from ordinary commuting later. This product does not decide that for you."
        >
          <LInput
            id={`${idPrefix}-purpose`}
            name="purpose"
            required
            placeholder="e.g. Drive to sim training, maintenance drop-off, FBO pickup"
            disabled={disabled}
            defaultValue={values.purpose}
          />
        </LField>
      </div>

      <div className="flex flex-col gap-1.5">
        <label id={`${idPrefix}-trip-label`} className="text-body-s font-medium text-ink">
          Trip
        </label>
        <LSelect
          aria-labelledby={`${idPrefix}-trip-label`}
          value={tripId}
          onChange={(e) => setTripId(e.target.value)}
          disabled={disabled}
        >
          <option value={NO_TRIP}>No trip</option>
          {trips.map((trip) => (
            <option key={trip.id} value={trip.id}>
              {trip.label}
            </option>
          ))}
        </LSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <label id={`${idPrefix}-client-label`} className="text-body-s font-medium text-ink">
          Client
        </label>
        <LSelect
          aria-labelledby={`${idPrefix}-client-label`}
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          disabled={disabled}
        >
          <option value={NO_CLIENT}>No client</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </LSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-rate`} className="text-body-s font-medium text-ink">
          Rate (cents/mile)
        </label>
        {rateLocked ? (
          <>
            <LInput
              id={`${idPrefix}-rate`}
              // NO name — never submitted. Locked once saved; see
              // EntryFields' rateLocked doc comment.
              value={values.rate_cents_per_mile}
              readOnly
              disabled
              className="tnum-l"
            />
            <p className="text-caption text-ink-3">
              Locked once saved, so a later rate change can never restate a
              drive already recorded. To fix a wrong rate, delete this drive
              and log it again.
            </p>
          </>
        ) : (
          <>
            <LInput
              id={`${idPrefix}-rate`}
              name="rate_cents_per_mile"
              required
              inputMode="decimal"
              disabled={disabled}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
            {yearRate !== undefined ? (
              <LButton
                type="button"
                variant="quiet"
                size="sm"
                disabled={disabled}
                onClick={() => setRate(formatRateForDisplay(yearRate))}
              >
                Use {year}&rsquo;s rate ({formatRateForDisplay(yearRate)}¢/mi)
              </LButton>
            ) : (
              <p className="text-caption text-warn">
                {year ? `No rate on file for ${year}. ` : ""}
                <NextLink href="/settings?tab=mileage" className="text-accent underline-offset-2 hover:underline">
                  Add it in Settings
                </NextLink>
                , or enter it manually.
              </p>
            )}
          </>
        )}
      </div>
      <div className="md:col-span-2">
        <LField label="Notes" htmlFor={`${idPrefix}-notes`}>
          <LTextarea
            id={`${idPrefix}-notes`}
            name="notes"
            rows={1}
            disabled={disabled}
            defaultValue={values.notes}
          />
        </LField>
      </div>
    </div>
  );
}

function emptyValues(preselectedTripId?: string) {
  return {
    drove_on: "",
    miles: "",
    from_place: "",
    to_place: "",
    purpose: "",
    trip_id: preselectedTripId ?? "",
    client_id: "",
    rate_cents_per_mile: "",
    notes: "",
  };
}

function rowValues(entry: MileageEntryRow) {
  return {
    drove_on: entry.drove_on,
    miles: String(entry.miles),
    from_place: entry.from_place,
    to_place: entry.to_place,
    purpose: entry.purpose,
    trip_id: entry.trip_id ?? "",
    client_id: entry.client_id ?? "",
    rate_cents_per_mile: formatRateForDisplay(entry.rate_cents_per_mile),
    notes: entry.notes ?? "",
  };
}

function AddEntryCard({
  trips,
  clients,
  rates,
}: {
  trips: TripOption[];
  clients: ClientOption[];
  rates: RatesByYear;
}) {
  const [state, formAction, pending] = useActionState(createMileageEntry, initialState);
  // React 19 resets an uncontrolled form on every dispatch, error path
  // included — a rejected submit would otherwise blank a form the pilot
  // just carefully filled in. Re-mounting the field block from the echoed
  // values (via `key`) is simpler here than threading each value through
  // `initial()` the way expense-form.tsx does, because EntryFields already
  // owns its own local state for the fields React would otherwise reset.
  const submitted = state.values;
  const values = submitted
    ? {
        drove_on: submitted.drove_on ?? "",
        miles: submitted.miles ?? "",
        from_place: submitted.from_place ?? "",
        to_place: submitted.to_place ?? "",
        purpose: submitted.purpose ?? "",
        trip_id: submitted.trip_id ?? "",
        client_id: submitted.client_id ?? "",
        rate_cents_per_mile: submitted.rate_cents_per_mile ?? "",
        notes: submitted.notes ?? "",
      }
    : emptyValues();

  return (
    <LCard>
      <form action={formAction}>
        <p className="mb-3 text-h3 font-bold">Log a drive</p>
        <EntryFields
          // Forces a remount whenever the echoed values change (a failed
          // submit). React calls the native form.reset() after EVERY action
          // dispatch, error path included — that wipes every uncontrolled
          // (defaultValue-based) field here (miles/from/to/purpose/notes)
          // back to its ORIGINAL mount value unless the field itself
          // remounts with the echoed value as its new default. Re-keying is
          // simpler than threading every field through the `initial()`
          // pattern expense-form.tsx uses, because EntryFields' own
          // useState hooks need to reinitialize too (droveOn/tripId/
          // clientId/rate), not just its defaultValue props.
          key={JSON.stringify(values)}
          idPrefix="add"
          values={values}
          trips={trips}
          clients={clients}
          rates={rates}
        />
        <div className="mt-3" role="alert" aria-live="polite">
          {state.error ? <p className="text-caption font-medium text-crit">{state.error}</p> : null}
        </div>
        <div className="mt-3">
          <LButton type="submit" disabled={pending}>
            {pending ? "Saving…" : "Add drive"}
          </LButton>
        </div>
      </form>
    </LCard>
  );
}

function EntryRow({
  entry,
  trips,
  clients,
  rates,
  editing,
  onEdit,
  onDone,
}: {
  entry: MileageEntryRow;
  trips: TripOption[];
  clients: ClientOption[];
  rates: RatesByYear;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateMileageEntry, initialState);
  const [deleting, startDelete] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // F: updateMileageEntry returns { error: null } (no `values`) only on
  // success — close the row back to its read-only view, same pattern as
  // leg-editor.tsx's LegEditForm. Without this the row just sat open with
  // "Saving…" flipping back to "Save" and nothing else, indistinguishable
  // from a submit that did nothing.
  useEffect(() => {
    if (state !== initialState && state.error === null) {
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const submitted = state.values;
  const values = submitted
    ? {
        drove_on: submitted.drove_on ?? "",
        miles: submitted.miles ?? "",
        from_place: submitted.from_place ?? "",
        to_place: submitted.to_place ?? "",
        purpose: submitted.purpose ?? "",
        trip_id: submitted.trip_id ?? "",
        client_id: submitted.client_id ?? "",
        rate_cents_per_mile: submitted.rate_cents_per_mile ?? "",
        notes: submitted.notes ?? "",
      }
    : rowValues(entry);

  const tripLabel = entry.trip_id ? trips.find((t) => t.id === entry.trip_id)?.label : null;
  const clientLabel = entry.client_id ? clients.find((c) => c.id === entry.client_id)?.name : null;

  function handleDelete() {
    startDelete(async () => {
      setDeleteError(null);
      const result = await deleteMileageEntry(entry.id);
      if (result.error) setDeleteError(result.error);
      else setConfirmOpen(false);
    });
  }

  if (!editing) {
    return (
      <tr>
        <th
          scope="row"
          className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
        >
          {formatDate(entry.drove_on)}
        </th>
        <LTd>
          <span className="tnum-l">{entry.miles}</span>
        </LTd>
        <LTd>
          <span className="text-ink-2">
            {entry.from_place} → {entry.to_place}
          </span>
        </LTd>
        <LTd>
          <span className="text-ink-2">{entry.purpose}</span>
        </LTd>
        <LTd>
          <span className="text-ink-2">{tripLabel ?? clientLabel ?? "—"}</span>
        </LTd>
        <LTd numeric>
          <span className="font-medium">{formatCents(entry.amount_cents)}</span>
        </LTd>
        <LTd>
          <div className="flex gap-2">
            <LButton type="button" size="sm" variant="outline" onClick={onEdit}>
              Edit
            </LButton>
            <LButton type="button" size="sm" variant="quiet" onClick={() => setConfirmOpen(true)}>
              Delete
            </LButton>
          </div>
          <LConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Delete this drive?"
            description={
              <>
                <p>
                  {formatDate(entry.drove_on)}, {entry.from_place} to {entry.to_place} (
                  {entry.miles} mi). This can&rsquo;t be undone.
                </p>
                {deleteError ? (
                  <p className="mt-2 text-caption font-medium text-crit" role="alert">
                    {deleteError}
                  </p>
                ) : null}
              </>
            }
            confirmLabel="Delete"
            confirmVariant="danger"
            onConfirm={handleDelete}
            pending={deleting}
          />
        </LTd>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={7} className="border-b border-hair px-3 py-2.5 align-baseline">
        <form
          action={(formData) => {
            formData.set("id", entry.id);
            return formAction(formData);
          }}
        >
          <input type="hidden" name="id" value={entry.id} />
          <EntryFields
            // See AddEntryCard's identical comment: remount on every echo
            // so the uncontrolled fields pick up the rejected submit's
            // values instead of reverting to the row's original data.
            key={JSON.stringify(values)}
            idPrefix={`edit-${entry.id}`}
            values={values}
            trips={trips}
            clients={clients}
            rates={rates}
            rateLocked
          />
          <div className="mt-2" role="alert" aria-live="polite">
            {state.error ? <p className="text-caption font-medium text-crit">{state.error}</p> : null}
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
      </td>
    </tr>
  );
}

export default function MileageForm({
  entries,
  trips,
  clients,
  rates,
}: {
  entries: MileageEntryRow[];
  trips: TripOption[];
  clients: ClientOption[];
  rates: RatesByYear;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <LAlert tone="neutral">
        This is a record of drives, not a determination of what&rsquo;s deductible. Commuting
        between home and a regular place of work generally isn&rsquo;t deductible. Whether a
        given drive counts turns on facts about your situation this product can&rsquo;t see.
        The standard mileage rate and actual vehicle expenses (tracked as fuel and rental-car
        expenses) are alternatives, not additive. Using both for the same vehicle in the same
        year can double-count. Confirm your method and your deductions with a tax professional.
      </LAlert>

      <AddEntryCard trips={trips} clients={clients} rates={rates} />

      <LCard>
        {entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="text-h3 font-bold">No drives logged yet</p>
            <p className="text-body-s text-ink-2">
              Log a drive above: date, miles, and what it was for.
            </p>
          </div>
        ) : (
          <LTable>
            <thead>
              <tr>
                <LTh>Date</LTh>
                <LTh>Miles</LTh>
                <LTh>Route</LTh>
                <LTh>Purpose</LTh>
                <LTh>Trip / client</LTh>
                <LTh numeric>Amount</LTh>
                <LTh />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  trips={trips}
                  clients={clients}
                  rates={rates}
                  editing={editingId === entry.id}
                  onEdit={() => setEditingId(entry.id)}
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
