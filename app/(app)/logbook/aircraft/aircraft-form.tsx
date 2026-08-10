"use client";

import { useActionState, useEffect, useState } from "react";
import { Button, Callout, Flex, Grid, Select, Text, TextArea, TextField } from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import type { AircraftFormState } from "./actions";
import { GEAR_LABEL, type AircraftGear } from "./db";

export type AircraftFormValues = {
  id?: string;
  tail_number?: string | null;
  type_designator?: string | null;
  make_model?: string | null;
  gear?: AircraftGear | null;
  category_class?: string | null;
  notes?: string | null;
};

// Radix Select.Item forbids an empty-string value, and "not recorded" is a
// real answer here rather than an absence — 61.57(a)(1)'s full-stop rule
// turns on gear, so a pilot who does not know must be able to say so.
const GEAR_UNSTATED = "__unstated__";

const initialState: AircraftFormState = { error: null };

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
            <TextField.Root
              id="type_designator"
              name="type_designator"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="C560"
              maxLength={4}
              defaultValue={initial("type_designator", values.type_designator)}
            />
            <Text size="1" color="gray">
              Optional. This is what your hours get grouped under — C560, BE40, PC12.
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
              defaultValue={initial("category_class", values.category_class)}
            />
            <Text size="1" color="gray">
              ASEL, AMEL, ASES, rotorcraft-helicopter — whatever fits.
            </Text>
          </Flex>
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
            Worth setting on a taildragger: 14 CFR 61.57(a)(1) only counts your three
            day landings toward currency if they were to a full stop in a tailwheel
            airplane. Leaving it unrecorded is fine — nothing will assume tricycle.
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
