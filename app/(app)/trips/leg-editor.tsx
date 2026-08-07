"use client";

import { useActionState, useState, useTransition } from "react";
import { Box, Button, Callout, Flex, Grid, Heading, Text, TextField } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { addLeg, deleteLeg, type LegFormState } from "./actions";

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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Flex direction="column" align="end">
      <Button
        variant="ghost"
        color="red"
        size="1"
        disabled={pending}
        aria-label={`Remove leg ${label}`}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteLeg(id, tripId);
            setError(result.error);
          })
        }
      >
        {pending ? "Removing…" : "Remove"}
      </Button>
      {error ? (
        <Text as="div" size="1" color="red">
          {error}
        </Text>
      ) : null}
    </Flex>
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
              <Flex key={leg.id} asChild justify="between" align="start" py="3">
                <li>
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
                  <DeleteLegButton
                    id={leg.id}
                    tripId={tripId}
                    label={`${leg.from_icao ?? "?"} to ${leg.to_icao ?? "?"} on ${formatDate(leg.leg_date)}`}
                  />
                </li>
              </Flex>
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
          <Heading as="h2" size="3" mb="3">
            Add a leg
          </Heading>
          <Grid columns={{ initial: "2", md: "6" }} gap="3">
            <Flex direction="column" gap="1" gridColumn={{ initial: "span 2", md: "span 1" }}>
              <Text as="label" size="2" weight="medium" htmlFor="leg_date">
                Date
              </Text>
              <TextField.Root
                id="leg_date"
                type="date"
                name="leg_date"
                required
                defaultValue={defaultDate}
              />
            </Flex>
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="from_icao">
                From
              </Text>
              <TextField.Root id="from_icao" name="from_icao" placeholder="KBED" />
            </Flex>
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="to_icao">
                To
              </Text>
              <TextField.Root id="to_icao" name="to_icao" placeholder="KTEB" />
            </Flex>
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="block_hours">
                Block
              </Text>
              <TextField.Root id="block_hours" type="number" name="block_hours" step="0.1" min="0" />
            </Flex>
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="night_hours">
                Night
              </Text>
              <TextField.Root id="night_hours" type="number" name="night_hours" step="0.1" min="0" />
            </Flex>
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="instrument_hours">
                Instrument
              </Text>
              <TextField.Root
                id="instrument_hours"
                type="number"
                name="instrument_hours"
                step="0.1"
                min="0"
              />
            </Flex>

            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="day_landings">
                Day landings
              </Text>
              <TextField.Root
                id="day_landings"
                type="number"
                name="day_landings"
                defaultValue={0}
                step="1"
                min="0"
              />
            </Flex>
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="night_takeoffs">
                Night takeoffs
              </Text>
              <TextField.Root
                id="night_takeoffs"
                type="number"
                name="night_takeoffs"
                defaultValue={0}
                step="1"
                min="0"
              />
            </Flex>
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="night_landings_full_stop">
                Night full-stop
              </Text>
              <TextField.Root
                id="night_landings_full_stop"
                type="number"
                name="night_landings_full_stop"
                defaultValue={0}
                step="1"
                min="0"
              />
              <Text size="1" color="gray">
                Counts for 61.57(b)
              </Text>
            </Flex>
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="night_landings_touch_go">
                Night touch &amp; go
              </Text>
              <TextField.Root
                id="night_landings_touch_go"
                type="number"
                name="night_landings_touch_go"
                defaultValue={0}
                step="1"
                min="0"
              />
            </Flex>
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="approaches">
                Approaches
              </Text>
              <TextField.Root
                id="approaches"
                type="number"
                name="approaches"
                defaultValue={0}
                step="1"
                min="0"
              />
            </Flex>
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="holds">
                Holds
              </Text>
              <TextField.Root id="holds" type="number" name="holds" defaultValue={0} step="1" min="0" />
            </Flex>
          </Grid>

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
