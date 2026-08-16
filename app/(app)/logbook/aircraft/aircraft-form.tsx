"use client";

import { useActionState, useEffect, useState } from "react";
import { LAlert, LButton } from "@/components/ledger";
import { LField, LInput, LSelect, LTextarea } from "@/components/ledger/forms";
import type { AircraftFormState } from "./actions";
import {
  CATEGORY_CLASS_SUGGESTIONS,
  GEAR_LABEL,
  TRISTATE_NO,
  TRISTATE_UNSTATED,
  TRISTATE_YES,
  tristateValue,
  type AircraftGear,
} from "./db";

export type AircraftFormValues = {
  id?: string;
  tail_number?: string | null;
  type_designator?: string | null;
  type_rating?: string | null;
  make_model?: string | null;
  gear?: AircraftGear | null;
  category_class?: string | null;
  is_turbine?: boolean | null;
  is_retractable?: boolean | null;
  notes?: string | null;
};

// The sentinel "not recorded" carries from the pre-Ledger Select.Item-era
// vocabulary — "not recorded" is a real answer here rather than an
// absence (61.57(a)(1)'s full-stop rule turns on gear, so a pilot who does
// not know must be able to say so) and the controlled + hidden-input
// wiring around it is this form's submission logic, not its skin (HARD
// RULE 5 keeps that untouched even though LSelect is a real native
// <select> that would not itself require it).
const GEAR_UNSTATED = "__unstated__";

const initialState: AircraftFormState = { error: null };

/**
 * A nullable boolean, as three named options rather than a checkbox.
 *
 * A CHECKBOX WOULD BE THE WRONG CONTROL, not merely a plainer one: an
 * unchecked box posts nothing and reads as "no", and these two columns are
 * documented — in the migrations and in db.ts — as three-state, where NULL
 * means nobody said and must never resolve to false. The pilot-history
 * report leans on that distinction to report how much of the fleet is
 * unannotated instead of quietly totalling a short figure, and a control
 * that cannot express "not recorded" would silently destroy it on the
 * first save of any existing airframe.
 */
function TriStateField({
  name,
  label,
  hint,
  submittedValue,
  storedValue,
}: {
  name: string;
  label: string;
  hint: React.ReactNode;
  submittedValue: string | undefined;
  storedValue: boolean | null | undefined;
}) {
  const [value, setValue] = useState(() =>
    submittedValue !== undefined
      ? submittedValue || TRISTATE_UNSTATED
      : tristateValue(storedValue)
  );
  useEffect(() => {
    if (submittedValue !== undefined) setValue(submittedValue || TRISTATE_UNSTATED);
  }, [submittedValue]);

  const labelId = `${name}-label`;
  return (
    <LField label={<span id={labelId}>{label}</span>} hint={hint}>
      <LSelect aria-labelledby={labelId} value={value} onChange={(e) => setValue(e.target.value)}>
        <option value={TRISTATE_UNSTATED}>Not recorded</option>
        <option value={TRISTATE_YES}>Yes</option>
        <option value={TRISTATE_NO}>No</option>
      </LSelect>
      <input type="hidden" name={name} value={value === TRISTATE_UNSTATED ? "" : value} />
    </LField>
  );
}

export default function AircraftForm({
  action,
  values = {},
  submitLabel,
  onDone,
}: {
  action: (state: AircraftFormState, formData: FormData) => Promise<AircraftFormState>;
  values?: AircraftFormValues;
  submitLabel: string;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const submitted = state.values;

  const initial = (key: string, stored: unknown, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  const [gear, setGear] = useState(
    () => submitted?.gear ?? (values.gear ? String(values.gear) : GEAR_UNSTATED)
  );
  useEffect(() => {
    if (submitted?.gear !== undefined) setGear(submitted.gear || GEAR_UNSTATED);
  }, [submitted]);

  // Closing the panel is the parent's business, so it gets told rather
  // than guessing. Keyed off the explicit `saved` flag: "no error and no
  // echoed values" also describes the INITIAL state, so testing for that
  // would have closed the panel on mount, before the pilot typed a
  // character.
  useEffect(() => {
    if (state.saved && onDone) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction}>
      <div className="flex flex-col gap-4">
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LField
            label="Registration"
            htmlFor="tail_number"
            hint="Write it however you like: N447SP, N-447SP, and n447sp are the same airframe here."
          >
            <LInput
              id="tail_number"
              name="tail_number"
              required
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="N447SP"
              defaultValue={initial("tail_number", values.tail_number)}
            />
          </LField>

          <LField label="ICAO type designator" htmlFor="type_designator" hint="Optional: C560, BE40, PC12.">
            {/* No maxLength. Truncating at 4 turned "Citation V" into
                "CITA" — which passes the 2-4 character rule, so the
                server's explanatory error never fired and 412 hours
                silently grouped under a type that does not exist. Better
                to accept it and say why it is wrong. */}
            <LInput
              id="type_designator"
              name="type_designator"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="C560"
              defaultValue={initial("type_designator", values.type_designator)}
            />
          </LField>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LField
            label="Type rating"
            htmlFor="type_rating"
            hint="Your hours group under this when you set it. Worth doing: one CE-500 rating covers the Citation 500, 501, 550, 551, S550, 552 and 560, which ICAO splits into five separate designators."
          >
            <LInput
              id="type_rating"
              name="type_rating"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="CE-500"
              defaultValue={initial("type_rating", values.type_rating)}
            />
          </LField>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LField
            label="Make and model"
            htmlFor="make_model"
            hint="How an underwriter’s pilot-history form asks for it."
          >
            <LInput
              id="make_model"
              name="make_model"
              placeholder="Cessna 560 Citation V"
              defaultValue={initial("make_model", values.make_model)}
            />
          </LField>

          <LField label="Category and class" htmlFor="category_class" hint="Pick one, or type your own.">
            <LInput
              id="category_class"
              name="category_class"
              placeholder="AMEL"
              list="aircraft-category-class"
              defaultValue={initial("category_class", values.category_class)}
            />
            {/* Suggestions, not a picker. The 61.5(b) list is closed, but a
                CHECK that is wrong for one pilot's aircraft is worse than a
                field they fill in themselves — and a rollup that sees
                "AMEL", "amel" and "Multi-Engine Land" as three classes is
                no rollup, so nudging toward one spelling is worth doing. */}
            <datalist id="aircraft-category-class">
              {CATEGORY_CLASS_SUGGESTIONS.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </LField>
        </div>

        {/* The two lines an insurance pilot-history form rates separately
            from total time, and the two this product could not answer at
            all until the fleet carried them. Neither is derivable from
            anything already on file: `gear` below records what the
            aeroplane stands on, not whether the legs fold, and nothing
            anywhere says what is under the cowling. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TriStateField
            name="is_turbine"
            label="Turbine powered"
            submittedValue={submitted?.is_turbine}
            storedValue={values.is_turbine}
            hint="Turbine time is its own line on a pilot-history form and an open-pilot warranty. Leaving it unrecorded is fine. Nothing here will assume piston."
          />
          <TriStateField
            name="is_retractable"
            label="Retractable gear"
            submittedValue={submitted?.is_retractable}
            storedValue={values.is_retractable}
            hint="Also its own rated line. Separate from the landing gear below: a Bonanza is tricycle and retractable, a Super Cub is tailwheel and fixed."
          />
        </div>

        <LField
          label={<span id="gear-label">Landing gear</span>}
          hint="Worth setting on a taildragger. Under 14 CFR 61.57(a)(1)(ii), if the airplane to be flown is an airplane with a tailwheel, the three required takeoffs and landings must have been made to a full stop in a tailwheel airplane. Leaving this unrecorded is fine. Nothing here will assume tricycle."
        >
          <LSelect aria-labelledby="gear-label" value={gear} onChange={(e) => setGear(e.target.value)}>
            <option value={GEAR_UNSTATED}>Not recorded</option>
            {(Object.keys(GEAR_LABEL) as AircraftGear[]).map((value) => (
              <option key={value} value={value}>
                {GEAR_LABEL[value]}
              </option>
            ))}
          </LSelect>
          <input type="hidden" name="gear" value={gear === GEAR_UNSTATED ? "" : gear} />
        </LField>

        <LField label="Notes" htmlFor="notes">
          <LTextarea
            id="notes"
            name="notes"
            rows={2}
            placeholder="Owner, management company, insurance open-pilot minimums…"
            defaultValue={initial("notes", values.notes)}
          />
        </LField>

        {state.error ? (
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>{state.error}</span>
          </LAlert>
        ) : null}

        <div className="flex gap-2">
          <LButton type="submit" disabled={pending}>
            {pending ? "Saving…" : submitLabel}
          </LButton>
        </div>
      </div>
    </form>
  );
}

/* ── Inline icon ───────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. Same shape as invoices/page.tsx's own WarningIcon. */
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
