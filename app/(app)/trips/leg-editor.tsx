"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { LButton } from "@/components/ledger";
import { LConfirmDialog } from "@/components/ledger/dialog";
import { LField, LInput } from "@/components/ledger/forms";
import { formatDate } from "@/lib/format";
import { addLeg, deleteLeg, updateLeg, type LegFormState } from "./actions";

const initialState: LegFormState = { error: null };

export type LegRow = {
  id: string;
  leg_date: string;
  from_icao: string | null;
  to_icao: string | null;
  block_hours: number | null;
  night_hours: number | null;
  instrument_hours: number | null;
  instrument_actual_hours: number | null;
  instrument_simulated_hours: number | null;
  cross_country_hours: number | null;
  day_takeoffs: number;
  day_landings: number;
  day_landings_full_stop: number;
  night_takeoffs: number;
  night_landings_full_stop: number;
  night_landings_touch_go: number;
  approaches: number;
  holds: number;
};

/**
 * The fields a leg's add/edit form shares — factored out so "Add a leg"
 * and the inline edit form (LegEditForm below) render the exact same
 * grid and can't drift apart on which counts are captured.
 */
function LegFieldGrid({
  idPrefix,
  initial,
}: {
  idPrefix: string;
  initial: (key: string, fallback?: string) => string;
}) {
  const id = (key: string) => `${idPrefix}-${key}`;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
      <div className="col-span-2 flex flex-col gap-1 md:col-span-1">
        <LField label="Date" htmlFor={id("leg_date")}>
          <LInput id={id("leg_date")} type="date" name="leg_date" required defaultValue={initial("leg_date")} />
        </LField>
      </div>
      <div className="flex flex-col gap-1">
        <LField label="From" htmlFor={id("from_icao")}>
          <LInput
            id={id("from_icao")}
            name="from_icao"
            placeholder="KBED"
            autoCapitalize="characters"
            spellCheck={false}
            className="uppercase"
            defaultValue={initial("from_icao")}
          />
        </LField>
      </div>
      <div className="flex flex-col gap-1">
        <LField label="To" htmlFor={id("to_icao")}>
          <LInput
            id={id("to_icao")}
            name="to_icao"
            placeholder="KTEB"
            autoCapitalize="characters"
            spellCheck={false}
            className="uppercase"
            defaultValue={initial("to_icao")}
          />
        </LField>
      </div>
      <div className="flex flex-col gap-1">
        <LField label="Block" htmlFor={id("block_hours")}>
          <LInput
            id={id("block_hours")}
            type="number"
            name="block_hours"
            step="0.1"
            min="0"
            defaultValue={initial("block_hours")}
          />
        </LField>
      </div>
      <div className="flex flex-col gap-1">
        <LField
          label="Night"
          htmlFor={id("night_hours")}
          hint="Civil twilight to civil twilight. Not the same window as the takeoff/landing counts below. (14 CFR 1.1)"
        >
          <LInput
            id={id("night_hours")}
            type="number"
            name="night_hours"
            step="0.1"
            min="0"
            defaultValue={initial("night_hours")}
          />
        </LField>
      </div>
      <div className="flex flex-col gap-1">
        <LField
          label="Instrument (actual)"
          htmlFor={id("instrument_actual_hours")}
          hint="Log actual and simulated instrument time separately. (14 CFR 61.51(b)(3)(ii))"
        >
          <LInput
            id={id("instrument_actual_hours")}
            type="number"
            name="instrument_actual_hours"
            step="0.1"
            min="0"
            defaultValue={initial("instrument_actual_hours")}
          />
        </LField>
      </div>
      <div className="flex flex-col gap-1">
        <LField label="Instrument (simulated)" htmlFor={id("instrument_simulated_hours")}>
          <LInput
            id={id("instrument_simulated_hours")}
            type="number"
            name="instrument_simulated_hours"
            step="0.1"
            min="0"
            defaultValue={initial("instrument_simulated_hours")}
          />
        </LField>
      </div>
      <div className="flex flex-col gap-1">
        <LField label="Cross-country" htmlFor={id("cross_country_hours")}>
          <LInput
            id={id("cross_country_hours")}
            type="number"
            name="cross_country_hours"
            step="0.1"
            min="0"
            defaultValue={initial("cross_country_hours")}
          />
        </LField>
      </div>
      {/* The legacy combined field, kept so a leg written before the
          actual/simulated split can still be read and corrected. Not
          derived from the two above and never used to fill them. */}
      <input type="hidden" name="instrument_hours" value={initial("instrument_hours")} />

      <div className="flex flex-col gap-1">
        <LField
          label="Day takeoffs"
          htmlFor={id("day_takeoffs")}
          hint="14 CFR 61.57(a)(1) counts takeoffs separately from landings"
        >
          <LInput
            id={id("day_takeoffs")}
            type="number"
            name="day_takeoffs"
            step="1"
            min="0"
            defaultValue={initial("day_takeoffs", "0")}
          />
        </LField>
      </div>
      <div className="flex flex-col gap-1">
        <LField label="Day landings" htmlFor={id("day_landings")}>
          <LInput
            id={id("day_landings")}
            type="number"
            name="day_landings"
            step="1"
            min="0"
            defaultValue={initial("day_landings", "0")}
          />
        </LField>
      </div>
      <div className="flex flex-col gap-1">
        <LField
          label="…of which full stop"
          htmlFor={id("day_landings_full_stop")}
          hint="Only 61.57(a)(1) tailwheel currency requires full stop by day"
        >
          <LInput
            id={id("day_landings_full_stop")}
            type="number"
            name="day_landings_full_stop"
            step="1"
            min="0"
            defaultValue={initial("day_landings_full_stop", "0")}
          />
        </LField>
      </div>
      <div className="flex flex-col gap-1">
        <LField
          label="Night takeoffs"
          htmlFor={id("night_takeoffs")}
          hint="1 hour after sunset to 1 hour before sunrise. (61.57(b))"
        >
          <LInput
            id={id("night_takeoffs")}
            type="number"
            name="night_takeoffs"
            step="1"
            min="0"
            defaultValue={initial("night_takeoffs", "0")}
          />
        </LField>
      </div>
      <div className="flex flex-col gap-1">
        <LField
          label="Night full-stop"
          htmlFor={id("night_landings_full_stop")}
          hint="Counts toward 61.57(b) currency: 1 hour after sunset to 1 hour before sunrise. Not the same window as Night above."
        >
          <LInput
            id={id("night_landings_full_stop")}
            type="number"
            name="night_landings_full_stop"
            step="1"
            min="0"
            defaultValue={initial("night_landings_full_stop", "0")}
          />
        </LField>
      </div>
      <div className="flex flex-col gap-1">
        <LField label="Night touch & go" htmlFor={id("night_landings_touch_go")}>
          <LInput
            id={id("night_landings_touch_go")}
            type="number"
            name="night_landings_touch_go"
            step="1"
            min="0"
            defaultValue={initial("night_landings_touch_go", "0")}
          />
        </LField>
      </div>
      <div className="flex flex-col gap-1">
        <LField label="Approaches" htmlFor={id("approaches")}>
          <LInput
            id={id("approaches")}
            type="number"
            name="approaches"
            step="1"
            min="0"
            defaultValue={initial("approaches", "0")}
          />
        </LField>
      </div>
      <div className="flex flex-col gap-1">
        <LField label="Holds" htmlFor={id("holds")}>
          <LInput id={id("holds")} type="number" name="holds" step="1" min="0" defaultValue={initial("holds", "0")} />
        </LField>
      </div>
    </div>
  );
}

/**
 * Inline correction for one leg — the fix for there being no edit path at
 * all. Reuses the add-leg form's field shape and updateLeg, the
 * update-action counterpart to addLeg (same validation, `values` echo on
 * a rejected save, and a UUID_RE-guarded id).
 */
function LegEditForm({
  tripId,
  leg,
  onCancel,
  onSaved,
}: {
  tripId: string;
  leg: LegRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateLeg, initialState);

  // updateLeg returns { error: null } (no `values`) only on success;
  // close the editor once that state lands. In an effect, not during
  // render, so this never fights React over updating the parent's state
  // while this component is still rendering.
  useEffect(() => {
    if (state !== initialState && state.error === null) {
      onSaved();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const submitted = state.values;
  const initial = (key: string, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    const stored = (leg as unknown as Record<string, unknown>)[key];
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  return (
    <div className="py-3">
      <form action={formAction}>
        <input type="hidden" name="id" value={leg.id} />
        <input type="hidden" name="trip_id" value={tripId} />
        <LegFieldGrid idPrefix={`edit-${leg.id}`} initial={initial} />

        <div className="mt-3" role="alert" aria-live="polite">
          {state.error ? <p className="text-caption font-medium text-crit">{state.error}</p> : null}
        </div>

        <div className="mt-3 flex gap-3">
          <LButton type="submit" variant="outline" disabled={pending}>
            {pending ? "Saving…" : "Save leg"}
          </LButton>
          <LButton type="button" variant="quiet" disabled={pending} onClick={onCancel}>
            Cancel
          </LButton>
        </div>
      </form>
    </div>
  );
}

function DeleteLegButton({
  id,
  tripId,
  label,
}: {
  id: string;
  tripId: string;
  /** Distinguishes this button from every other "Remove" on the page. */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteLeg(id, tripId);
      if (result.error) {
        setError(result.error);
      } else {
        setOpen(false);
      }
    });
  }

  return (
    <div className="flex flex-col items-end">
      <LButton
        type="button"
        variant="quiet"
        size="sm"
        className="text-crit hover:text-crit"
        aria-label={`Remove leg ${label}`}
        onClick={() => setOpen(true)}
      >
        Remove
      </LButton>
      <LConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Remove this leg?"
        description={
          <>
            This removes the leg. Its block time and its FAR 61.57 currency counts (night
            takeoffs, full-stop and touch-and-go night landings, approaches, holds) go with
            it. This can&rsquo;t be undone. If you just need to fix a typo, cancel and use Edit
            instead.
            {error ? (
              <p className="mt-2 text-caption font-medium text-crit" role="alert">
                {error}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Remove leg"
        onConfirm={handleDelete}
        pending={pending}
      />
      {error && !open ? <p className="text-caption text-crit">{error}</p> : null}
    </div>
  );
}

function LegListItem({ tripId, leg }: { tripId: string; leg: LegRow }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li>
        <LegEditForm
          tripId={tripId}
          leg={leg}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      </li>
    );
  }

  const label = `${leg.from_icao ?? "?"} to ${leg.to_icao ?? "?"} on ${formatDate(leg.leg_date)}`;

  return (
    <li>
      <div className="flex items-start justify-between gap-3 py-3">
        <div>
          <div className="text-body-s font-medium text-ink">
            {leg.from_icao ?? "—"} → {leg.to_icao ?? "—"}
          </div>
          <div className="tnum-l text-caption text-ink-3">
            {formatDate(leg.leg_date)}
            {leg.block_hours ? ` · ${leg.block_hours} block` : ""}
            {leg.night_hours ? ` · ${leg.night_hours} night` : ""}
            {leg.instrument_hours ? ` · ${leg.instrument_hours} inst` : ""}
          </div>
          <div className="tnum-l text-caption text-ink-3">
            {leg.day_landings} day ldg · {leg.night_takeoffs} night T/O ·{" "}
            {leg.night_landings_full_stop} night full-stop ·{" "}
            {leg.night_landings_touch_go} night T&amp;G ·{" "}
            {leg.approaches} appr · {leg.holds} hold
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-3">
          <LButton
            type="button"
            variant="quiet"
            size="sm"
            aria-label={`Edit leg ${label}`}
            onClick={() => setEditing(true)}
          >
            Edit
          </LButton>
          <DeleteLegButton id={leg.id} tripId={tripId} label={label} />
        </div>
      </div>
    </li>
  );
}

/**
 * Legs are captured one at a time rather than as an editable grid. A leg
 * carries the currency-relevant counts (night takeoffs, full-stop vs
 * touch-and-go night landings, approaches, holds) that FAR 61.57 is
 * computed from, and those are worth typing deliberately once rather than
 * tabbing past in a dense table.
 *
 * The full-stop / touch-and-go split is not a nicety: 61.57(b) requires
 * night landings **to a full stop**, and a logbook that records only a
 * total night-landing count cannot answer the question at all.
 *
 * A typo'd leg no longer has to be deleted and retyped: each leg can be
 * edited in place (LegEditForm/updateLeg), and deleting one goes through
 * a confirm dialog that names exactly what's lost, matching every other
 * destructive action in the product.
 */
export default function LegEditor({
  tripId,
  legs,
  defaultDate,
}: {
  tripId: string;
  legs: LegRow[];
  defaultDate: string;
}) {
  const [state, formAction, pending] = useActionState(addLeg, initialState);

  const addInitial = (key: string, fallback = "") => {
    const echoed = state.values?.[key];
    if (echoed !== undefined) return echoed;
    if (key === "leg_date" && fallback === "") return defaultDate;
    return fallback;
  };

  return (
    <div>
      {legs.length === 0 ? (
        <div className="pb-4">
          <p className="text-body-s text-ink-2">
            No legs yet. Add them as you fly. They become the route on the
            invoice and the draft entries for your logbook.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-hair pb-3 [list-style:none] m-0 p-0">
          {legs.map((leg) => (
            <LegListItem key={leg.id} tripId={tripId} leg={leg} />
          ))}
        </ul>
      )}

      {/* React 19 resets an uncontrolled form after a form action
          completes, so the fields clear on their own once a leg is added —
          no manual reset, and none of the races one would bring. */}
      <div className="pt-3">
        <form action={formAction}>
          <input type="hidden" name="trip_id" value={tripId} />
          <h3 className="mb-3 text-h3 font-semibold">Add a leg</h3>
          <LegFieldGrid idPrefix="add" initial={addInitial} />

          <div className="mt-3" role="alert" aria-live="polite">
            {state.error ? <p className="text-caption font-medium text-crit">{state.error}</p> : null}
          </div>

          <div className="mt-4">
            <LButton type="submit" variant="outline" disabled={pending}>
              {pending ? "Adding…" : "Add leg"}
            </LButton>
          </div>
        </form>
      </div>
    </div>
  );
}
