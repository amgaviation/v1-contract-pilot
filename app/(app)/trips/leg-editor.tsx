"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  AlertDialog,
  Box,
  Button,
  Callout,
  Flex,
  Grid,
  Heading,
  Text,
  TextField,
} from "@/components/ui";
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
  day_landings: number;
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
    <Grid columns={{ initial: "2", md: "6" }} gap="3">
      <Flex direction="column" gap="1" gridColumn={{ initial: "span 2", md: "span 1" }}>
        <Text as="label" size="2" weight="medium" htmlFor={id("leg_date")}>
          Date
        </Text>
        <TextField.Root
          id={id("leg_date")}
          type="date"
          name="leg_date"
          required
          defaultValue={initial("leg_date")}
        />
      </Flex>
      <Flex direction="column" gap="1">
        <Text as="label" size="2" weight="medium" htmlFor={id("from_icao")}>
          From
        </Text>
        <TextField.Root
          id={id("from_icao")}
          name="from_icao"
          placeholder="KBED"
          defaultValue={initial("from_icao")}
        />
      </Flex>
      <Flex direction="column" gap="1">
        <Text as="label" size="2" weight="medium" htmlFor={id("to_icao")}>
          To
        </Text>
        <TextField.Root
          id={id("to_icao")}
          name="to_icao"
          placeholder="KTEB"
          defaultValue={initial("to_icao")}
        />
      </Flex>
      <Flex direction="column" gap="1">
        <Text as="label" size="2" weight="medium" htmlFor={id("block_hours")}>
          Block
        </Text>
        <TextField.Root
          id={id("block_hours")}
          type="number"
          name="block_hours"
          step="0.1"
          min="0"
          defaultValue={initial("block_hours")}
        />
      </Flex>
      <Flex direction="column" gap="1">
        <Text as="label" size="2" weight="medium" htmlFor={id("night_hours")}>
          Night
        </Text>
        <TextField.Root
          id={id("night_hours")}
          type="number"
          name="night_hours"
          step="0.1"
          min="0"
          defaultValue={initial("night_hours")}
        />
      </Flex>
      <Flex direction="column" gap="1">
        <Text as="label" size="2" weight="medium" htmlFor={id("instrument_hours")}>
          Instrument
        </Text>
        <TextField.Root
          id={id("instrument_hours")}
          type="number"
          name="instrument_hours"
          step="0.1"
          min="0"
          defaultValue={initial("instrument_hours")}
        />
      </Flex>

      <Flex direction="column" gap="1">
        <Text as="label" size="2" weight="medium" htmlFor={id("day_landings")}>
          Day landings
        </Text>
        <TextField.Root
          id={id("day_landings")}
          type="number"
          name="day_landings"
          step="1"
          min="0"
          defaultValue={initial("day_landings", "0")}
        />
      </Flex>
      <Flex direction="column" gap="1">
        <Text as="label" size="2" weight="medium" htmlFor={id("night_takeoffs")}>
          Night takeoffs
        </Text>
        <TextField.Root
          id={id("night_takeoffs")}
          type="number"
          name="night_takeoffs"
          step="1"
          min="0"
          defaultValue={initial("night_takeoffs", "0")}
        />
      </Flex>
      <Flex direction="column" gap="1">
        <Text as="label" size="2" weight="medium" htmlFor={id("night_landings_full_stop")}>
          Night full-stop
        </Text>
        <TextField.Root
          id={id("night_landings_full_stop")}
          type="number"
          name="night_landings_full_stop"
          step="1"
          min="0"
          defaultValue={initial("night_landings_full_stop", "0")}
        />
        <Text size="1" color="gray">
          Counts for 61.57(b)
        </Text>
      </Flex>
      <Flex direction="column" gap="1">
        <Text as="label" size="2" weight="medium" htmlFor={id("night_landings_touch_go")}>
          Night touch &amp; go
        </Text>
        <TextField.Root
          id={id("night_landings_touch_go")}
          type="number"
          name="night_landings_touch_go"
          step="1"
          min="0"
          defaultValue={initial("night_landings_touch_go", "0")}
        />
      </Flex>
      <Flex direction="column" gap="1">
        <Text as="label" size="2" weight="medium" htmlFor={id("approaches")}>
          Approaches
        </Text>
        <TextField.Root
          id={id("approaches")}
          type="number"
          name="approaches"
          step="1"
          min="0"
          defaultValue={initial("approaches", "0")}
        />
      </Flex>
      <Flex direction="column" gap="1">
        <Text as="label" size="2" weight="medium" htmlFor={id("holds")}>
          Holds
        </Text>
        <TextField.Root
          id={id("holds")}
          type="number"
          name="holds"
          step="1"
          min="0"
          defaultValue={initial("holds", "0")}
        />
      </Flex>
    </Grid>
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
    <Box asChild py="3">
      <form action={formAction}>
        <input type="hidden" name="id" value={leg.id} />
        <input type="hidden" name="trip_id" value={tripId} />
        <LegFieldGrid idPrefix={`edit-${leg.id}`} initial={initial} />

        <Box mt="3" role="alert" aria-live="polite">
          {state.error ? (
            <Callout.Root color="red" size="1">
              <Callout.Text>{state.error}</Callout.Text>
            </Callout.Root>
          ) : null}
        </Box>

        <Flex mt="3" gap="3">
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? "Saving…" : "Save leg"}
          </Button>
          <Button type="button" variant="ghost" color="gray" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
        </Flex>
      </form>
    </Box>
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
    <Flex direction="column" align="end">
      <AlertDialog.Root open={open} onOpenChange={setOpen}>
        <AlertDialog.Trigger>
          <Button variant="ghost" color="red" size="1" aria-label={`Remove leg ${label}`}>
            Remove
          </Button>
        </AlertDialog.Trigger>
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>Remove this leg?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            This removes the leg — its block time and its FAR 61.57 currency counts (night
            takeoffs, full-stop and touch-and-go night landings, approaches, holds) go with
            it. This can&rsquo;t be undone. If you just need to fix a typo, cancel and use Edit
            instead.
          </AlertDialog.Description>
          {error ? (
            <Box mt="2">
              <Text size="1" color="red" role="alert">
                {error}
              </Text>
            </Box>
          ) : null}
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray" disabled={pending}>
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <Button variant="solid" color="red" disabled={pending} onClick={handleDelete}>
              {pending ? "Removing…" : "Remove leg"}
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
      {error && !open ? (
        <Text as="div" size="1" color="red">
          {error}
        </Text>
      ) : null}
    </Flex>
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
      <Flex justify="between" align="start" py="3" gap="3">
        <Box>
          <Text as="div" size="2" weight="medium">
            {leg.from_icao ?? "—"} → {leg.to_icao ?? "—"}
          </Text>
          <Text as="div" size="1" color="gray" className="tnum">
            {formatDate(leg.leg_date)}
            {leg.block_hours ? ` · ${leg.block_hours} block` : ""}
            {leg.night_hours ? ` · ${leg.night_hours} night` : ""}
            {leg.instrument_hours ? ` · ${leg.instrument_hours} inst` : ""}
          </Text>
          <Text as="div" size="1" color="gray" className="tnum">
            {leg.day_landings} day ldg · {leg.night_takeoffs} night T/O ·{" "}
            {leg.night_landings_full_stop} night full-stop ·{" "}
            {leg.night_landings_touch_go} night T&amp;G ·{" "}
            {leg.approaches} appr · {leg.holds} hold
          </Text>
        </Box>
        <Flex gap="3" align="start" flexShrink="0">
          <Button
            type="button"
            variant="ghost"
            size="1"
            aria-label={`Edit leg ${label}`}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
          <DeleteLegButton id={leg.id} tripId={tripId} label={label} />
        </Flex>
      </Flex>
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
    <Box>
      {legs.length === 0 ? (
        <Box pb="4">
          <Text size="2" color="gray">
            No legs yet. Add them as you fly — they become the route on the
            invoice and the draft entries for your logbook.
          </Text>
        </Box>
      ) : (
        <Flex direction="column" pb="3" asChild>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {legs.map((leg) => (
              <LegListItem key={leg.id} tripId={tripId} leg={leg} />
            ))}
          </ul>
        </Flex>
      )}

      {/* React 19 resets an uncontrolled form after a form action
          completes, so the fields clear on their own once a leg is added —
          no manual reset, and none of the races one would bring. */}
      <Box asChild pt="3">
        <form action={formAction}>
          <input type="hidden" name="trip_id" value={tripId} />
          <Heading as="h3" size="3" mb="3">
            Add a leg
          </Heading>
          <LegFieldGrid idPrefix="add" initial={addInitial} />

          <Box mt="3" role="alert" aria-live="polite">
            {state.error ? (
              <Callout.Root color="red" size="1">
                <Callout.Text>{state.error}</Callout.Text>
              </Callout.Root>
            ) : null}
          </Box>

          <Box mt="4">
            <Button type="submit" variant="outline" disabled={pending}>
              {pending ? "Adding…" : "Add leg"}
            </Button>
          </Box>
        </form>
      </Box>
    </Box>
  );
}
