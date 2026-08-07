"use client";

import { useState, useTransition } from "react";
import { Box, Button, Flex, Select, Text } from "@radix-ui/themes";
import { fileExpense } from "./actions";

export type QueueRow = {
  id: string;
  label: string;
  detail: string;
  tripId: string | null;
};

export type QueueTrip = { id: string; label: string };

// Radix Select forbids an item with value="" — the sentinel stands in for
// "no trip chosen" in this component's own local state only (fileExpense
// takes tripId as a plain argument, not a FormData field, so there is no
// name to preserve here — just the "" it expects for "no trip").
const NO_TRIP = "none";

/**
 * Files one receipt without leaving the page. The queue's whole purpose
 * is that these receipts are currently earning the pilot nothing in
 * either direction, so the fix has to be two clicks — sending them
 * through the full edit form for a decision this small is what leaves the
 * queue permanently full.
 */
function QueueItem({ row, trips }: { row: QueueRow; trips: QueueTrip[] }) {
  const [tripId, setTripId] = useState(row.tripId ?? NO_TRIP);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function file(treatment: "rebill" | "deduct") {
    setError(null);
    startTransition(async () => {
      const result = await fileExpense(row.id, tripId === NO_TRIP ? "" : tripId, treatment);
      setError(result.error);
    });
  }

  return (
    <Box asChild py="3">
      <li>
        <Flex
          direction={{ initial: "column", md: "row" }}
          justify="between"
          align={{ initial: "stretch", md: "center" }}
          gap="4"
        >
          <Box>
            <Text as="div" weight="medium">
              {row.label}
            </Text>
            <Text as="div" size="1" color="gray">
              {row.detail}
            </Text>
          </Box>

          <Flex gap="3" align="center" wrap="wrap">
            <Box style={{ minWidth: "14rem" }}>
              <Select.Root value={tripId} onValueChange={setTripId}>
                <Select.Trigger aria-label={`Trip for ${row.label}`} />
                <Select.Content>
                  <Select.Item value={NO_TRIP}>No trip</Select.Item>
                  {trips.map((trip) => (
                    <Select.Item key={trip.id} value={trip.id}>
                      {trip.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Box>

            <Button
              variant="outline"
              size="2"
              // Rebill needs a trip — the database refuses the pair
              // outright, so the control refuses it first.
              disabled={pending || tripId === NO_TRIP}
              onClick={() => file("rebill")}
              aria-label={`Rebill ${row.label} to the client`}
            >
              Rebill
            </Button>
            <Button
              variant="outline"
              color="green"
              size="2"
              disabled={pending}
              onClick={() => file("deduct")}
              aria-label={`Keep ${row.label} as a deduction`}
            >
              Deduct
            </Button>
          </Flex>
        </Flex>

        {error ? (
          <Box mt="2" role="alert">
            <Text size="1" color="red">
              {error}
            </Text>
          </Box>
        ) : null}
      </li>
    </Box>
  );
}

export default function UnassignedQueue({
  rows,
  trips,
}: {
  rows: QueueRow[];
  trips: QueueTrip[];
}) {
  return (
    <Box asChild style={{ listStyle: "none", margin: 0, padding: 0 }}>
      <ul>
        {rows.map((row) => (
          <QueueItem key={row.id} row={row} trips={trips} />
        ))}
      </ul>
    </Box>
  );
}
