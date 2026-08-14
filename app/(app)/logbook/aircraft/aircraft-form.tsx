"use client";

import { useActionState, useEffect, useState } from "react";
import { Button, Callout, Flex, Grid, Select, Text, TextArea, TextField } from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
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

// Radix Select.Item forbids an empty-string value, and "not recorded" is a
// real answer here rather than an absence — 61.57(a)(1)'s full-stop rule
// turns on gear, so a pilot who does not know must be able to say so.
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
 *
 * Same Radix mechanics as the gear picker below it: Radix's Select posts
 * through a bubble <select> rendered with `defaultValue`, so React 19's
 * post-action form.reset() would restore it to its mount-time option even
 * on a rejected submit. `name` is kept off it and the real value posts
 * from a controlled hidden input.
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
    <Flex direction="column" gap="1">
      <Text as="label" size="1" color="gray" id={labelId}>
        {label}
      </Text>
      <Select.Root value={value} onValueChange={setValue}>
        <Select.Trigger aria-labelledby={labelId} />
        <Select.Content>
          <Select.Item value={TRISTATE_UNSTATED}>Not recorded</Select.Item>
          <Select.Item value={TRISTATE_YES}>Yes</Select.Item>
          <Select.Item value={TRISTATE_NO}>No</Select.Item>
        </Select.Content>
      </Select.Root>
      <input
        type="hidden"
        name={name}
        value={value === TRISTATE_UNSTATED ? "" : value}
      />
      <Text size="1" color="gray">
        {hint}
      </Text>
    </Flex>
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

  // Radix's Select posts through a bubble <select> rendered with
  // `defaultValue`, so React 19's post-action form.reset() would restore
  // it to its mount-time option even on a rejected submit. `name` is kept
  // off it and the real value posts from a controlled hidden input.
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
      <Flex direction="column" gap="4">
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

        <Grid columns={{ initial: "1", sm: "2" }} gap="3">
          <Flex direction="column" gap="1">
            <Text as="label" size="1" color="gray" htmlFor="tail_number">
              Registration
            </Text>
            <TextField.Root
              id="tail_number"
              name="tail_number"
              required
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="N447SP"
              defaultValue={initial("tail_number", values.tail_number)}
            />
            <Text size="1" color="gray">
              Write it however you like — N447SP, N-447SP and n447sp are the same
              airframe here.
            </Text>
          </Flex>

          <Flex direction="column" gap="1">
            <Text as="label" size="1" color="gray" htmlFor="type_designator">
              ICAO type designator
            </Text>
            {/* No maxLength. Truncating at 4 turned "Citation V" into
                "CITA" — which passes the 2-4 character rule, so the
                server's explanatory error never fired and 412 hours
                silently grouped under a type that does not exist. Better
                to accept it and say why it is wrong. */}
            <TextField.Root
              id="type_designator"
              name="type_designator"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="C560"
              defaultValue={initial("type_designator", values.type_designator)}
            />
            <Text size="1" color="gray">
              Optional — C560, BE40, PC12.
            </Text>
          </Flex>
        </Grid>

        <Grid columns={{ initial: "1", sm: "2" }} gap="3">
          <Flex direction="column" gap="1">
            <Text as="label" size="1" color="gray" htmlFor="type_rating">
              Type rating
            </Text>
            <TextField.Root
              id="type_rating"
              name="type_rating"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="CE-500"
              defaultValue={initial("type_rating", values.type_rating)}
            />
            <Text size="1" color="gray">
              Your hours group under this when you set it. Worth doing: one CE-500
              rating covers the Citation 500, 501, 550, 551, S550, 552 and 560, which
              ICAO splits into five separate designators.
            </Text>
          </Flex>
        </Grid>

        <Grid columns={{ initial: "1", sm: "2" }} gap="3">
          <Flex direction="column" gap="1">
            <Text as="label" size="1" color="gray" htmlFor="make_model">
              Make and model
            </Text>
            <TextField.Root
              id="make_model"
              name="make_model"
              placeholder="Cessna 560 Citation V"
              defaultValue={initial("make_model", values.make_model)}
            />
            <Text size="1" color="gray">
              How an underwriter&rsquo;s pilot-history form asks for it.
            </Text>
          </Flex>

          <Flex direction="column" gap="1">
            <Text as="label" size="1" color="gray" htmlFor="category_class">
              Category and class
            </Text>
            <TextField.Root
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
            <Text size="1" color="gray">
              Pick one, or type your own.
            </Text>
          </Flex>
        </Grid>

        {/* The two lines an insurance pilot-history form rates separately
            from total time, and the two this product could not answer at
            all until the fleet carried them. Neither is derivable from
            anything already on file: `gear` below records what the
            aeroplane stands on, not whether the legs fold, and nothing
            anywhere says what is under the cowling. */}
        <Grid columns={{ initial: "1", sm: "2" }} gap="3">
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
        </Grid>

        <Flex direction="column" gap="1">
          <Text as="label" size="1" color="gray" id="gear-label">
            Landing gear
          </Text>
          <Select.Root value={gear} onValueChange={setGear}>
            <Select.Trigger aria-labelledby="gear-label" />
            <Select.Content>
              <Select.Item value={GEAR_UNSTATED}>Not recorded</Select.Item>
              {(Object.keys(GEAR_LABEL) as AircraftGear[]).map((value) => (
                <Select.Item key={value} value={value}>
                  {GEAR_LABEL[value]}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <input type="hidden" name="gear" value={gear === GEAR_UNSTATED ? "" : gear} />
          <Text size="1" color="gray">
            Worth setting on a taildragger. Under 14 CFR 61.57(a)(1)(ii), if the
            airplane to be flown is an airplane with a tailwheel, the three required
            takeoffs and landings must have been made to a full stop in a tailwheel
            airplane. Leaving this unrecorded is fine — nothing here will assume
            tricycle.
          </Text>
        </Flex>

        <Flex direction="column" gap="1">
          <Text as="label" size="1" color="gray" htmlFor="notes">
            Notes
          </Text>
          <TextArea
            id="notes"
            name="notes"
            rows={2}
            placeholder="Owner, management company, insurance open-pilot minimums…"
            defaultValue={initial("notes", values.notes)}
          />
        </Flex>

        {state.error ? (
          <Callout.Root color="red" size="1">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>{state.error}</Callout.Text>
          </Callout.Root>
        ) : null}

        <Flex gap="2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : submitLabel}
          </Button>
        </Flex>
      </Flex>
    </form>
  );
}
