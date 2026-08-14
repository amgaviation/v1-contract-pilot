"use client";

import { useState } from "react";
import { Badge, Button, Card, Flex, Heading, Table, Text } from "@/components/ui";
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
    <Flex direction="column" gap="4">
      {suggestions.length > 0 ? (
        <Card>
          <Flex direction="column" gap="3" p="1">
            <Flex direction="column" gap="1">
              <Heading as="h2" size="4">
                {moreSuggestions
                  ? `${suggestions.length} of the tails you've flown but haven't added`
                  : `${suggestions.length} tail${suggestions.length === 1 ? "" : "s"} you've flown but haven't added`}
              </Heading>
            </Flex>
            <Flex gap="2" wrap="wrap">
              {suggestions.map((suggestion) => (
                <Button
                  key={suggestion.tailKey}
                  type="button"
                  variant="outline"
                  onClick={() => openFromSuggestion(suggestion)}
                >
                  <Flex direction="column" align="start" gap="0">
                    <Text size="2" weight="medium">
                      {suggestion.aircraftIdent}
                    </Text>
                    <Text size="1" color="gray">
                      {`${hours(suggestion.totalTime)} hrs · ${suggestion.entryCount} entr${
                        suggestion.entryCount === 1 ? "y" : "ies"
                      }`}
                    </Text>
                  </Flex>
                </Button>
              ))}
            </Flex>
          </Flex>
        </Card>
      ) : null}

      {open === "new" ? (
        <Card>
          <Flex direction="column" gap="3" p="1">
            <Flex justify="between" align="center" gap="3">
              <Heading as="h2" size="4">
                {prefill ? `Add ${prefill.aircraftIdent}` : "Add an aircraft"}
              </Heading>
              <Button type="button" variant="ghost" size="1" onClick={() => setOpen(null)}>
                Cancel
              </Button>
            </Flex>
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
          </Flex>
        </Card>
      ) : (
        <Flex>
          <Button type="button" onClick={openBlank}>
            Add an aircraft
          </Button>
        </Flex>
      )}

      <Card>
        {active.length === 0 && archived.length === 0 ? (
          <Flex direction="column" gap="2" p="3" align="center">
            <Text size="2" weight="medium">
              No aircraft yet.
            </Text>
            <Text size="2" color="gray" align="center">
              Add the airframes you fly and your logbook starts answering &ldquo;how much
              time do you have in type?&rdquo; — the question every insurance
              pilot-history form and every chief pilot asks.
            </Text>
          </Flex>
        ) : (
          <Table.Root variant="ghost">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Registration</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Type</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Hours</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">PIC</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Last flown</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {[...active, ...archived].map((item) => (
                <Table.Row key={item.id}>
                  <Table.RowHeaderCell>
                    <Flex align="center" gap="2">
                      <Text weight="medium">{item.tail_number}</Text>
                      {item.archived_at ? (
                        <Badge color="gray" variant="outline">
                          Retired
                        </Badge>
                      ) : null}
                      {item.gear === "tailwheel" ? (
                        <Badge color="amber" variant="outline">
                          {GEAR_LABEL.tailwheel}
                        </Badge>
                      ) : null}
                    </Flex>
                  </Table.RowHeaderCell>
                  <Table.Cell>
                    <Flex direction="column">
                      <Text>{item.type_rating ?? item.type_designator ?? "—"}</Text>
                      {item.make_model ? (
                        <Text size="1" color="gray">
                          {item.make_model}
                        </Text>
                      ) : null}
                    </Flex>
                  </Table.Cell>
                  <Table.Cell justify="end">
                    <Flex direction="column" align="end">
                      <Text className="tnum">
                        {hoursUnavailable ? "—" : hours(item.totalTime)}
                      </Text>
                      {/* Simulator hours are not aircraft hours and are
                          never added into the figure above — an
                          underwriter's form asks for them separately. Shown
                          here so they are not simply missing. */}
                      {!hoursUnavailable && item.simulatorTime > 0 ? (
                        <Text size="1" color="gray" className="tnum">
                          {`+${hours(item.simulatorTime)} sim`}
                        </Text>
                      ) : null}
                    </Flex>
                  </Table.Cell>
                  <Table.Cell justify="end">
                    <Text color="gray" className="tnum">
                      {hoursUnavailable ? "—" : hours(item.picTime)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text color="gray">
                      {hoursUnavailable
                        ? "—"
                        : item.lastFlownOn
                          ? formatDate(item.lastFlownOn)
                          : "Not yet"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell justify="end">
                    <Flex gap="2" justify="end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="1"
                        onClick={() => setOpen(open === item.id ? null : item.id)}
                      >
                        {open === item.id ? "Close" : "Edit"}
                      </Button>
                      <form action={setAircraftArchived}>
                        <input type="hidden" name="id" value={item.id} />
                        <input
                          type="hidden"
                          name="archived"
                          value={item.archived_at ? "false" : "true"}
                        />
                        <Button type="submit" variant="ghost" size="1" color="gray">
                          {item.archived_at ? "Bring back" : "Retire"}
                        </Button>
                      </form>
                    </Flex>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </Card>

      {open && open !== "new"
        ? (() => {
            const editing = aircraft.find((a) => a.id === open);
            if (!editing) return null;
            return (
              <Card>
                <Flex direction="column" gap="3" p="1">
                  <Flex justify="between" align="center" gap="3">
                    <Heading as="h2" size="4">{`Edit ${editing.tail_number}`}</Heading>
                    <Button type="button" variant="ghost" size="1" onClick={() => setOpen(null)}>
                      Cancel
                    </Button>
                  </Flex>
                  <AircraftForm
                    key={editing.id}
                    action={updateAircraft}
                    submitLabel="Save"
                    values={editing}
                    onDone={() => setOpen(null)}
                  />
                  <Text size="1" color="gray">
                    {`${editing.entryCount} logbook entr${
                      editing.entryCount === 1 ? "y" : "ies"
                    } are matched to this airframe. Correcting the registration re-matches them — there's no separate cleanup to do.`}
                  </Text>
                </Flex>
              </Card>
            );
          })()
        : null}
    </Flex>
  );
}
