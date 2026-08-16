"use client";

import { useState } from "react";
import { LButton, LCard, LPill, LTable, LTd, LTh } from "@/components/ledger";
import { formatDate } from "@/lib/format";
import AircraftForm from "./aircraft-form";
import { createAircraft, updateAircraft, setAircraftArchived } from "./actions";
import { GEAR_LABEL, type AircraftGear } from "./db";

/**
 * The fleet, and the two ways it grows: from a tail the pilot has already
 * flown, or typed in fresh.
 *
 * The suggestion list is the important half. A registry a pilot has to
 * populate by retyping registrations their own logbook already holds is a
 * registry that stays empty, and an empty registry means the hours-by-type
 * rollup — the thing an underwriter's pilot-history form asks for — has
 * nothing to group on.
 */

export type FleetAircraft = {
  id: string;
  tail_number: string;
  type_designator: string | null;
  type_rating: string | null;
  make_model: string | null;
  gear: AircraftGear | null;
  category_class: string | null;
  notes: string | null;
  archived_at: string | null;
  entryCount: number;
  totalTime: number;
  picTime: number;
  simulatorTime: number;
  lastFlownOn: string | null;
};

export type Suggestion = {
  tailKey: string;
  aircraftIdent: string;
  aircraftType: string | null;
  entryCount: number;
  totalTime: number;
  lastFlownOn: string;
};

function hours(value: number): string {
  return value.toFixed(1);
}

export default function FleetPanel({
  aircraft,
  suggestions,
  moreSuggestions = false,
  hoursUnavailable = false,
}: {
  aircraft: FleetAircraft[];
  suggestions: Suggestion[];
  /** More unregistered tails exist than are shown. Said out loud, not implied. */
  moreSuggestions?: boolean;
  /** The hours query failed. Columns read blank, never zero. */
  hoursUnavailable?: boolean;
}) {
  // `null` = closed, "new" = the blank add form, otherwise an aircraft id.
  const [open, setOpen] = useState<string | null>(null);
  // A suggestion clicked into the add form: prefills what the logbook
  // already knows so the pilot confirms rather than retypes.
  const [prefill, setPrefill] = useState<Suggestion | null>(null);

  const active = aircraft.filter((a) => a.archived_at === null);
  const archived = aircraft.filter((a) => a.archived_at !== null);

  function openBlank() {
    setPrefill(null);
    setOpen("new");
  }
  function openFromSuggestion(suggestion: Suggestion) {
    setPrefill(suggestion);
    setOpen("new");
  }

  return (
    <div className="flex flex-col gap-4">
      {suggestions.length > 0 ? (
        <LCard>
          <div className="flex flex-col gap-3">
            <h2 className="text-h3 font-semibold">
              {moreSuggestions
                ? `${suggestions.length} of the tails you've flown but haven't added`
                : `${suggestions.length} tail${suggestions.length === 1 ? "" : "s"} you've flown but haven't added`}
            </h2>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
                <LButton
                  key={suggestion.tailKey}
                  type="button"
                  variant="outline"
                  className="h-auto flex-col items-start gap-0 py-2"
                  onClick={() => openFromSuggestion(suggestion)}
                >
                  <span className="text-body-s font-medium">{suggestion.aircraftIdent}</span>
                  <span className="text-caption text-ink-3">
                    {`${hours(suggestion.totalTime)} hrs · ${suggestion.entryCount} entr${
                      suggestion.entryCount === 1 ? "y" : "ies"
                    }`}
                  </span>
                </LButton>
              ))}
            </div>
          </div>
        </LCard>
      ) : null}

      {open === "new" ? (
        <LCard>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-h3 font-semibold">
                {prefill ? `Add ${prefill.aircraftIdent}` : "Add an aircraft"}
              </h2>
              <LButton type="button" variant="quiet" size="sm" onClick={() => setOpen(null)}>
                Cancel
              </LButton>
            </div>
            <AircraftForm
              // Remounts when the prefill changes so the uncontrolled
              // fields pick up the new defaults — without the key, clicking
              // a second suggestion would leave the first one's values in
              // the boxes.
              key={prefill?.tailKey ?? "blank"}
              action={createAircraft}
              submitLabel="Add to my fleet"
              values={
                prefill
                  ? {
                      tail_number: prefill.aircraftIdent,
                      // Only prefilled when what the pilot typed on their
                      // entries is already designator-shaped. "Citation V"
                      // in aircraft_type would fail the CHECK, and putting
                      // it in the box just to have it rejected is worse
                      // than leaving the field empty.
                      type_designator:
                        prefill.aircraftType && /^[A-Za-z0-9]{2,4}$/.test(prefill.aircraftType)
                          ? prefill.aircraftType
                          : null,
                      make_model:
                        prefill.aircraftType && !/^[A-Za-z0-9]{2,4}$/.test(prefill.aircraftType)
                          ? prefill.aircraftType
                          : null,
                    }
                  : {}
              }
              onDone={() => setOpen(null)}
            />
          </div>
        </LCard>
      ) : (
        <div>
          <LButton type="button" onClick={openBlank}>
            Add an aircraft
          </LButton>
        </div>
      )}

      <LCard>
        {active.length === 0 && archived.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-3 text-center">
            <p className="text-body-s font-medium text-ink">No aircraft yet.</p>
            <p className="text-body-s text-ink-2">
              Add the airframes you fly and your logbook starts answering &ldquo;how much
              time do you have in type?&rdquo; That&rsquo;s the question every insurance
              pilot-history form and every chief pilot asks.
            </p>
          </div>
        ) : (
          <LTable>
            <caption>
              <span className="sr-only">Your aircraft</span>
            </caption>
            <thead>
              <tr>
                <LTh>Registration</LTh>
                <LTh>Type</LTh>
                <LTh numeric>Hours</LTh>
                <LTh numeric>PIC</LTh>
                <LTh>Last flown</LTh>
                <LTh />
              </tr>
            </thead>
            <tbody>
              {[...active, ...archived].map((item) => (
                <tr key={item.id}>
                  <th
                    scope="row"
                    className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                  >
                    <div className="flex items-center gap-2">
                      <span>{item.tail_number}</span>
                      {item.archived_at ? <LPill tone="neutral">Retired</LPill> : null}
                      {item.gear === "tailwheel" ? (
                        <LPill tone="warn">{GEAR_LABEL.tailwheel}</LPill>
                      ) : null}
                    </div>
                  </th>
                  <LTd>
                    <div className="flex flex-col">
                      <span>{item.type_rating ?? item.type_designator ?? "—"}</span>
                      {item.make_model ? (
                        <span className="text-caption text-ink-3">{item.make_model}</span>
                      ) : null}
                    </div>
                  </LTd>
                  <LTd numeric>
                    <div className="flex flex-col items-end">
                      <span>{hoursUnavailable ? "—" : hours(item.totalTime)}</span>
                      {/* Simulator hours are not aircraft hours and are
                          never added into the figure above — an
                          underwriter's form asks for them separately. Shown
                          here so they are not simply missing. */}
                      {!hoursUnavailable && item.simulatorTime > 0 ? (
                        <span className="tnum-l text-caption text-ink-3">
                          {`+${hours(item.simulatorTime)} sim`}
                        </span>
                      ) : null}
                    </div>
                  </LTd>
                  <LTd numeric>
                    <span className="text-ink-2">{hoursUnavailable ? "—" : hours(item.picTime)}</span>
                  </LTd>
                  <LTd>
                    <span className="text-ink-2">
                      {hoursUnavailable
                        ? "—"
                        : item.lastFlownOn
                          ? formatDate(item.lastFlownOn)
                          : "Not yet"}
                    </span>
                  </LTd>
                  <LTd numeric>
                    <div className="flex justify-end gap-2">
                      <LButton
                        type="button"
                        variant="quiet"
                        size="sm"
                        onClick={() => setOpen(open === item.id ? null : item.id)}
                      >
                        {open === item.id ? "Close" : "Edit"}
                      </LButton>
                      <form action={setAircraftArchived}>
                        <input type="hidden" name="id" value={item.id} />
                        <input
                          type="hidden"
                          name="archived"
                          value={item.archived_at ? "false" : "true"}
                        />
                        <LButton type="submit" variant="quiet" size="sm">
                          {item.archived_at ? "Bring back" : "Retire"}
                        </LButton>
                      </form>
                    </div>
                  </LTd>
                </tr>
              ))}
            </tbody>
          </LTable>
        )}
      </LCard>

      {open && open !== "new"
        ? (() => {
            const editing = aircraft.find((a) => a.id === open);
            if (!editing) return null;
            return (
              <LCard>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-h3 font-semibold">{`Edit ${editing.tail_number}`}</h2>
                    <LButton type="button" variant="quiet" size="sm" onClick={() => setOpen(null)}>
                      Cancel
                    </LButton>
                  </div>
                  <AircraftForm
                    key={editing.id}
                    action={updateAircraft}
                    submitLabel="Save"
                    values={editing}
                    onDone={() => setOpen(null)}
                  />
                  <p className="text-caption text-ink-3">
                    {`${editing.entryCount} logbook entr${
                      editing.entryCount === 1 ? "y" : "ies"
                    } are matched to this airframe. Correcting the registration re-matches them; there's no separate cleanup to do.`}
                  </p>
                </div>
              </LCard>
            );
          })()
        : null}
    </div>
  );
}
