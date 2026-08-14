"use client";

import { useActionState, useEffect, useId, useState } from "react";
import NextLink from "next/link";
import { Button, Card, Checkbox, Flex, Grid, Heading, Select, Text, TextArea, TextField } from "@/components/ui";
import TailNumberField from "@/components/tail-number-field";
import type { FleetOption } from "@/lib/fleet";
import type { LogbookFormState } from "./actions";

export type LogbookEntryFormValues = {
  id?: string;
  entry_date?: string | null;
  aircraft_ident?: string | null;
  aircraft_type?: string | null;
  from_icao?: string | null;
  to_icao?: string | null;
  role?: string | null;
  total_time?: number | null;
  pic_time?: number | null;
  sic_time?: number | null;
  solo_time?: number | null;
  cross_country_time?: number | null;
  night_time?: number | null;
  instrument_actual_time?: number | null;
  instrument_simulated_time?: number | null;
  flight_instructor_time?: number | null;
  dual_received_time?: number | null;
  simulator_time?: number | null;
  simulator_device_type?: string | null;
  day_takeoffs?: number | null;
  day_landings_full_stop?: number | null;
  day_landings_touch_go?: number | null;
  night_takeoffs?: number | null;
  night_landings_full_stop?: number | null;
  night_landings_touch_go?: number | null;
  approaches_count?: number | null;
  approach_type?: string | null;
  approach_condition?: string | null;
  courses_intercepted_tracked?: boolean | null;
  holds?: number | null;
  view_limiting_pilot_name?: string | null;
  remarks?: string | null;
};

const ROLES = [
  { value: "PIC", label: "PIC" },
  { value: "SIC", label: "SIC" },
  { value: "SOLO", label: "Solo" },
  { value: "DUAL_RECEIVED", label: "Dual received" },
];

// The roleless choice, for an entry whose time is entirely simulator time
// (20260810020000) — an FFS/FTD/ATD session has no pilot in command
// because there is no aircraft.
//
// Offered unconditionally rather than shown only when the times qualify:
// total_time and simulator_time are uncontrolled inputs here, so gating
// the option on them would mean making both controlled just to hide a
// menu item, and the server has to re-check the times regardless. Picking
// it on a real flight comes back with a sentence saying exactly why it
// was refused, which is the same answer with less machinery.
const ROLE_NONE_LABEL = "No role — simulator session";

// Radix Select.Item forbids an empty-string value, so the "no selection"
// options below use this sentinel and are translated back to "" before
// the value reaches the form's actual field name.
const NONE = "__none__";

const SIMULATOR_DEVICES = [
  { value: NONE, label: "N/A" },
  { value: "ffs", label: "Full flight simulator (FFS)" },
  { value: "ftd", label: "FTD" },
  { value: "atd", label: "ATD" },
  { value: "other", label: "Other device" },
];

const APPROACH_TYPES = [
  { value: NONE, label: "Not recorded" },
  { value: "ils", label: "ILS" },
  { value: "rnav_lpv", label: "RNAV (LPV)" },
  { value: "rnav_lnav", label: "RNAV (LNAV)" },
  { value: "vor", label: "VOR" },
  { value: "loc", label: "LOC" },
  { value: "ndb", label: "NDB" },
  { value: "visual", label: "Visual" },
  { value: "other", label: "Other" },
];

// 61.57(c)(1) condition — a different axis from APPROACH_TYPES above (the
// procedure flown vs. the weather/device it was flown under). Kept as its
// own Select so the two are never conflated in the UI, per the migration's
// column comment.
const APPROACH_CONDITIONS = [
  { value: NONE, label: "Unknown / not recorded" },
  { value: "actual", label: "Actual instrument conditions" },
  { value: "simulated", label: "Simulated — view-limiting device" },
  { value: "neither", label: "Neither (e.g. flown visually)" },
];

const initialState: LogbookFormState = { error: null };

/**
 * Shared by /logbook/new (manual create) and /logbook/[id] (edit, any
 * source). It only ever writes flight-data columns — source, trip linkage
 * and import lineage are never form fields, because they aren't in the
 * UPDATE grant and createLogbookEntry sets them itself. See actions.ts.
 */
export default function LogbookEntryForm({
  action,
  values = {},
  submitLabel,
  provenanceNote,
  fleet = [],
}: {
  action: (state: LogbookFormState, formData: FormData) => Promise<LogbookFormState>;
  values?: LogbookEntryFormValues;
  submitLabel: string;
  /** Read-only context shown above the form, e.g. "Confirmed from a trip on 12 AUG 2026". */
  provenanceNote?: string;
  /**
   * The pilot's registered airframes, offered as suggestions on the tail
   * number. Defaults to none so the field degrades to exactly the plain
   * text box it was before pilot.aircraft existed.
   */
  fleet?: FleetOption[];
}) {
  // Select.Root never controls the native <select> Radix mounts for form
  // submission (it always renders `defaultValue`, never `value` — see
  // @radix-ui/react-select's SelectBubbleInput), so a React-19 post-action
  // form reset silently reverts it to its mount-time option no matter what
  // the pilot picked. We drop `name` off every Select.Root so it stops
  // emitting that bubble input, and post the value from our own controlled
  // hidden input instead, which React re-asserts after a reset.
  async function wrappedAction(prevState: LogbookFormState, formData: FormData) {
    for (const key of ["simulator_device_type", "approach_type", "approach_condition"]) {
      if (formData.get(key) === NONE) formData.set(key, "");
    }
    return action(prevState, formData);
  }
  const [state, formAction, pending] = useActionState(wrappedAction, initialState);

  // Echoed submission wins over the row's stored values — React 19 resets
  // an uncontrolled form on every dispatch, including a rejected one.
  const submitted = state.values;
  const initial = (key: keyof LogbookEntryFormValues, fallback = "") => {
    const echoed = submitted?.[key as string];
    if (echoed !== undefined) return echoed;
    const stored = values[key];
    return stored === null || stored === undefined ? fallback : String(stored);
  };
  const initialSelect = (key: keyof LogbookEntryFormValues, fallback = "") => {
    const value = initial(key, fallback);
    return value === "" ? NONE : value;
  };

  // Seeded from the entry's OWN role, with NONE for a roleless
  // (wholly-simulator) entry — NOT defaulted to "PIC". It used to default,
  // which meant opening an imported simulator session and saving an
  // unrelated correction silently rewrote its role to PIC in a legal
  // record. Caught in review before it shipped.
  //
  // On a fresh /logbook/new (no values.id — there is no stored row yet),
  // NONE is the wrong seed too: initialSelect("role") turns the absent
  // value into NONE, which matches Select.Item's NONE option and made
  // Radix render its label ("No role — simulator session") as if it were
  // already chosen — the product's most-used capture screen opening with
  // the role field apparently answered. Seed "" instead so nothing is
  // preselected; NONE stays the seed only when editing an existing row
  // that is genuinely roleless (a wholly-simulator entry).
  const [role, setRole] = useState(() => (values.id ? initialSelect("role") : initial("role", "")));
  const [simulatorDeviceType, setSimulatorDeviceType] = useState(() => initialSelect("simulator_device_type"));
  const [approachType, setApproachType] = useState(() => initialSelect("approach_type"));
  const [approachCondition, setApproachCondition] = useState(() => initialSelect("approach_condition"));
  // Drives whether the safety-pilot-name prompt shows (61.51(b)(1)(v) is
  // only relevant when instrument_simulated_time > 0 — see the field's
  // note below). Not validated as a hard requirement — the schema and
  // this form cannot themselves evaluate 91.109's applicability.
  const [instrumentSimulatedTime, setInstrumentSimulatedTime] = useState(() =>
    Number(initial("instrument_simulated_time", "0")) || 0
  );
  const [coursesInterceptedTracked, setCoursesInterceptedTracked] = useState(
    () => initial("courses_intercepted_tracked", "") === "on" || Boolean(values.courses_intercepted_tracked)
  );

  // Re-seed from the echoed submission whenever the action returns state
  // (e.g. after a rejected submit), so the pilot's choice is what's shown
  // AND what's posted next, not the mount-time value.
  useEffect(() => {
    // Echoes the submitted role verbatim, including a deliberate blank —
    // "|| 'PIC'" here would re-introduce the silent default on the error
    // path, which is where it would be hardest to notice.
    if (submitted?.role !== undefined) setRole(submitted.role ? String(submitted.role) : NONE);
    if (submitted?.simulator_device_type !== undefined) {
      setSimulatorDeviceType(submitted.simulator_device_type ? String(submitted.simulator_device_type) : NONE);
    }
    if (submitted?.approach_type !== undefined) {
      setApproachType(submitted.approach_type ? String(submitted.approach_type) : NONE);
    }
    if (submitted?.approach_condition !== undefined) {
      setApproachCondition(submitted.approach_condition ? String(submitted.approach_condition) : NONE);
    }
    if (submitted?.instrument_simulated_time !== undefined) {
      setInstrumentSimulatedTime(Number(submitted.instrument_simulated_time) || 0);
    }
    if (submitted?.courses_intercepted_tracked !== undefined) {
      setCoursesInterceptedTracked(String(submitted.courses_intercepted_tracked) === "on");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  const roleId = useId();
  const deviceId = useId();
  const approachId = useId();
  const approachConditionId = useId();
  const interceptTrackId = useId();

  return (
    <Card>
      <form action={formAction}>
        <Flex direction="column" gap="4" p="2">
          {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

          {provenanceNote ? (
            <Text size="1" color="gray">
              {provenanceNote}
            </Text>
          ) : null}

          <Heading as="h2" size="4">
            The flight
          </Heading>
          <Grid columns={{ initial: "2", md: "12" }} gap="3">
            <LabeledField label="Date" htmlFor="entry_date" gridColumn={{ md: "span 3" }}>
              <TextField.Root
                id="entry_date"
                type="date"
                name="entry_date"
                required
                defaultValue={initial("entry_date")}
              />
            </LabeledField>
            <LabeledField label="Tail number" htmlFor="aircraft_ident" gridColumn={{ md: "span 3" }}>
              <TailNumberField
                id="aircraft_ident"
                name="aircraft_ident"
                fleet={fleet}
                placeholder="Tail number"
                defaultValue={initial("aircraft_ident")}
                typeFieldId="aircraft_type"
              />
            </LabeledField>
            <LabeledField label="Aircraft type" htmlFor="aircraft_type" gridColumn={{ md: "span 3" }}>
              <TextField.Root
                id="aircraft_type"
                name="aircraft_type"
                placeholder="Aircraft type (e.g. CE-560XL)"
                defaultValue={initial("aircraft_type")}
              />
            </LabeledField>
            <LabeledField label="From" htmlFor="from_icao" gridColumn={{ md: "span 2" }}>
              <TextField.Root
                id="from_icao"
                name="from_icao"
                placeholder="From (KBED)"
                defaultValue={initial("from_icao")}
              />
            </LabeledField>
            <LabeledField label="To" htmlFor="to_icao" gridColumn={{ md: "span 1" }}>
              <TextField.Root id="to_icao" name="to_icao" placeholder="To (KTEB)" defaultValue={initial("to_icao")} />
            </LabeledField>
          </Grid>
          <Flex direction="column" gap="1" style={{ maxWidth: 240 }}>
            <Text as="label" htmlFor={roleId} size="1" color="gray">
              Role
            </Text>
            <Select.Root value={role} onValueChange={setRole}>
              <Select.Trigger id={roleId} aria-label="Role" placeholder="Choose a role" />
              <Select.Content>
                {ROLES.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
                <Select.Item value={NONE}>{ROLE_NONE_LABEL}</Select.Item>
              </Select.Content>
            </Select.Root>
            {/* NONE is a Radix-only sentinel (Select.Item forbids ""), so
                it is translated back to the empty string the server reads
                as "no role" — same pattern every other optional Select in
                this form uses. */}
            <input type="hidden" name="role" value={role === NONE ? "" : role} />
          </Flex>

          <Heading as="h2" size="4" mt="2">
            Time (hours, tenths)
          </Heading>
          <Grid columns={{ initial: "2", md: "6" }} gap="3">
            <LabeledNumber name="total_time" label="Total time" required defaultValue={initial("total_time")} />
            <LabeledNumber name="pic_time" label="PIC" defaultValue={initial("pic_time")} />
            <LabeledNumber name="sic_time" label="SIC" defaultValue={initial("sic_time")} />
            <LabeledNumber name="solo_time" label="Solo" defaultValue={initial("solo_time")} />
            <LabeledNumber name="cross_country_time" label="Cross-country" defaultValue={initial("cross_country_time")} />
            <LabeledNumber
              name="night_time"
              label="Night"
              defaultValue={initial("night_time")}
              hint="14 CFR 1.1: end of evening civil twilight to beginning of morning civil twilight"
            />
            <LabeledNumber
              name="instrument_actual_time"
              label="Instrument, actual"
              defaultValue={initial("instrument_actual_time")}
            />
            <LabeledNumber
              name="instrument_simulated_time"
              label="Instrument, hood/sim"
              defaultValue={initial("instrument_simulated_time")}
              onChangeValue={setInstrumentSimulatedTime}
            />
            <LabeledNumber
              name="flight_instructor_time"
              label="CFI given"
              defaultValue={initial("flight_instructor_time")}
            />
            <LabeledNumber
              name="dual_received_time"
              label="Dual received"
              defaultValue={initial("dual_received_time")}
            />
            <LabeledNumber
              name="simulator_time"
              label="Full flight simulator / FTD / ATD"
              defaultValue={initial("simulator_time")}
            />
            <Flex direction="column" gap="1">
              <Text as="label" htmlFor={deviceId} size="1" color="gray">
                Device type
              </Text>
              <Select.Root value={simulatorDeviceType} onValueChange={setSimulatorDeviceType}>
                <Select.Trigger id={deviceId} aria-label="Device type" />
                <Select.Content>
                  {SIMULATOR_DEVICES.map((option) => (
                    <Select.Item key={option.value} value={option.value}>
                      {option.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              <input
                type="hidden"
                name="simulator_device_type"
                value={simulatorDeviceType === NONE ? "" : simulatorDeviceType}
              />
              <Text size="1" color="gray">
                Required if sim time &gt; 0
              </Text>
            </Flex>
          </Grid>

          {instrumentSimulatedTime > 0 ? (
            <LabeledField label="Safety pilot name" htmlFor="view_limiting_pilot_name" maxWidth="360px">
              <TextField.Root
                id="view_limiting_pilot_name"
                name="view_limiting_pilot_name"
                placeholder="Required by 91.109 for some simulated-instrument flights"
                defaultValue={initial("view_limiting_pilot_name")}
              />
              <Text size="1" color="gray">
                14 CFR 61.51(b)(1)(v) — name the safety pilot if 91.109 required one for this flight.
              </Text>
            </LabeledField>
          ) : null}

          <Heading as="h2" size="4" mt="2">
            Landings, approaches, holds
          </Heading>
          <Grid columns={{ initial: "2", md: "6" }} gap="3">
            <LabeledNumber
              name="day_takeoffs"
              label="Day takeoffs"
              step="1"
              defaultValue={initial("day_takeoffs", "0")}
              hint="61.57(a): every aircraft carrying persons, or certificated for more than 1 pilot crewmember — not day-only"
            />
            <LabeledNumber
              name="day_landings_full_stop"
              label="Day full-stop"
              step="1"
              defaultValue={initial("day_landings_full_stop", "0")}
            />
            <LabeledNumber
              name="day_landings_touch_go"
              label="Day touch & go"
              step="1"
              defaultValue={initial("day_landings_touch_go", "0")}
            />
            <LabeledNumber
              name="night_takeoffs"
              label="Night takeoffs"
              step="1"
              defaultValue={initial("night_takeoffs", "0")}
              hint="61.57(b): 1 hr after sunset – 1 hr before sunrise (not the same window as Night time above)"
            />
            <LabeledNumber
              name="night_landings_full_stop"
              label="Night full-stop"
              step="1"
              defaultValue={initial("night_landings_full_stop", "0")}
              hint="61.57(b): 1 hr after sunset – 1 hr before sunrise (not the same window as Night time above)"
            />
            <LabeledNumber
              name="night_landings_touch_go"
              label="Night touch & go"
              step="1"
              defaultValue={initial("night_landings_touch_go", "0")}
            />
            <LabeledNumber name="holds" label="Holds" step="1" defaultValue={initial("holds", "0")} />
            <LabeledNumber
              name="approaches_count"
              label="Approaches"
              step="1"
              defaultValue={initial("approaches_count", "0")}
              hint="Instrument approaches in actual or simulated instrument conditions — counts for 61.57(c). A Visual-tagged approach below does not."
            />
            <Flex direction="column" gap="1" gridColumn={{ md: "span 2" }}>
              <Text as="label" htmlFor={approachId} size="1" color="gray">
                Approach type
              </Text>
              <Select.Root value={approachType} onValueChange={setApproachType}>
                <Select.Trigger id={approachId} aria-label="Approach type" />
                <Select.Content>
                  {APPROACH_TYPES.map((option) => (
                    <Select.Item key={option.value} value={option.value}>
                      {option.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              <input type="hidden" name="approach_type" value={approachType === NONE ? "" : approachType} />
              <Text size="1" color="gray">
                If the source gives you one. Visual does not count for 61.57(c).
              </Text>
            </Flex>
            <Flex direction="column" gap="1" gridColumn={{ md: "span 2" }}>
              <Text as="label" htmlFor={approachConditionId} size="1" color="gray">
                Approach condition
              </Text>
              <Select.Root value={approachCondition} onValueChange={setApproachCondition}>
                <Select.Trigger id={approachConditionId} aria-label="Approach condition" />
                <Select.Content>
                  {APPROACH_CONDITIONS.map((option) => (
                    <Select.Item key={option.value} value={option.value}>
                      {option.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              <input
                type="hidden"
                name="approach_condition"
                value={approachCondition === NONE ? "" : approachCondition}
              />
              <Text size="1" color="gray">
                61.57(c)(1): actual instrument conditions or a view-limiting device — a different question from
                approach TYPE above. Leave unknown rather than guessing.
              </Text>
            </Flex>
            <Flex direction="column" gap="1" justify="end" gridColumn={{ md: "span 2" }}>
              <Text as="label" size="2" htmlFor={interceptTrackId}>
                <Flex gap="2" align="center">
                  <Checkbox
                    id={interceptTrackId}
                    checked={coursesInterceptedTracked}
                    onCheckedChange={(checked) => setCoursesInterceptedTracked(checked === true)}
                  />
                  Intercepted &amp; tracked a course (61.57(c)(1)(iii))
                </Flex>
              </Text>
              <input
                type="hidden"
                name="courses_intercepted_tracked"
                value={coursesInterceptedTracked ? "on" : ""}
              />
            </Flex>
          </Grid>

          <Flex direction="column" gap="1">
            <Text as="label" htmlFor="remarks" size="1" color="gray">
              Remarks
            </Text>
            <TextArea id="remarks" name="remarks" rows={2} defaultValue={initial("remarks")} />
          </Flex>

          {/* role="alert" so a screen reader hears the rejection; the form
              resets on every dispatch and nothing else announces it. */}
          <div role="alert" aria-live="polite">
            {state.error ? (
              <Text size="1" color="red">
                {state.error}
              </Text>
            ) : null}
          </div>

          <Flex gap="3">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
            <Button asChild variant="outline">
              <NextLink href="/logbook">Cancel</NextLink>
            </Button>
          </Flex>
        </Flex>
      </form>
    </Card>
  );
}

/**
 * `gridColumn` rather than a raw `style` prop.
 *
 * A raw inline style applies at EVERY width. The parent Grid here is
 * columns={{ initial: "2", md: "12" }}, so on a phone it is two columns
 * wide while its children were still asking for span 3 — CSS Grid then
 * places them into implicit auto-width tracks and the row comes out
 * uneven and unpredictable. Measured in Chromium at 390px: three fields
 * at full width and the last two at 179 and 199 px, against a uniform
 * 189 px once the span is scoped to md and up.
 *
 * This is the product's most-used mobile capture screen — a pilot filling
 * in a logbook entry between legs — so it is the worst place in the app
 * for it.
 */
function LabeledField({
  label,
  htmlFor,
  gridColumn,
  maxWidth,
  children,
}: {
  label: string;
  htmlFor: string;
  gridColumn?: React.ComponentProps<typeof Flex>["gridColumn"];
  /** Radix's own max-width scale, not a raw pixel style. */
  maxWidth?: React.ComponentProps<typeof Flex>["maxWidth"];
  children: React.ReactNode;
}) {
  return (
    <Flex direction="column" gap="1" gridColumn={gridColumn} maxWidth={maxWidth}>
      <Text as="label" htmlFor={htmlFor} size="1" color="gray">
        {label}
      </Text>
      {children}
    </Flex>
  );
}

function LabeledNumber({
  name,
  label,
  defaultValue,
  required,
  step = "0.1",
  hint,
  onChangeValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
  required?: boolean;
  step?: string;
  hint?: string;
  /** Optional live-value callback, e.g. so another field can react (see instrument_simulated_time). */
  onChangeValue?: (value: number) => void;
}) {
  return (
    <Flex direction="column" gap="1">
      <Text as="label" htmlFor={name} size="1" color="gray">
        {label}
      </Text>
      <TextField.Root
        id={name}
        type="number"
        name={name}
        required={required}
        min="0"
        step={step}
        defaultValue={defaultValue}
        className="tnum"
        onChange={onChangeValue ? (e) => onChangeValue(Number(e.target.value) || 0) : undefined}
      />
      {hint ? (
        <Text size="1" color="gray">
          {hint}
        </Text>
      ) : null}
    </Flex>
  );
}
