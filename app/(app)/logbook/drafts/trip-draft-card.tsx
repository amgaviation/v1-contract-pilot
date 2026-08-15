"use client";

import { useId, useState } from "react";
import NextLink from "next/link";
import { Card, Flex, Heading, Link, Select, Table, Text } from "@/components/ui";
import { formatDate, formatDateRange } from "@/lib/format";
import type { LogbookRole } from "../db";
import { ConfirmLegButton, ConfirmTripButton } from "./confirm-draft-button";

export type DraftCardLeg = {
  id: string;
  leg_date: string;
  from_icao: string | null;
  to_icao: string | null;
  block_hours: number | null;
  night_hours: number | null;
  instrument_hours: number | null;
  instrument_actual_hours: number | null;
  instrument_simulated_hours: number | null;
  day_landings: number;
  day_landings_full_stop: number | null;
  night_takeoffs: number;
  night_landings_full_stop: number;
  night_landings_touch_go: number;
};

const ROLE_OPTIONS: { value: LogbookRole; label: string }[] = [
  { value: "PIC", label: "PIC" },
  { value: "SIC", label: "SIC" },
];

/**
 * One completed trip's unconfirmed legs, reviewed and confirmed together.
 *
 * CRITICAL fix: confirming used to write role='PIC' / pic_time=block_hours
 * on every leg without ever asking — the word "PIC" never appeared on
 * this screen. Role is now an explicit choice the pilot makes HERE,
 * before either confirm control is enabled; the batch button applies it
 * to every leg on the trip (see confirmTripDrafts's comment for why a
 * single trip-wide choice, not one per leg, is the right batch shape),
 * and per-leg Confirm uses the same choice so the two controls can never
 * disagree about what they're about to write.
 */
export default function TripDraftCard({
  trip,
  legs,
}: {
  trip: {
    id: string;
    starts_on: string;
    ends_on: string;
    aircraft_ident: string | null;
    aircraft_type: string | null;
  };
  legs: DraftCardLeg[];
}) {
  const [role, setRole] = useState<LogbookRole | null>(null);
  const roleLabelId = useId();

  return (
    <Card>
      <Flex direction="column" gap="3" p="2">
        <Flex justify="between" align="start" gap="3" wrap="wrap">
          <Flex direction="column">
            <Heading as="h3" size="4">
              <Link asChild>
                <NextLink href={`/trips/${trip.id}`}>
                  {formatDateRange(trip.starts_on, trip.ends_on)}
                </NextLink>
              </Link>
            </Heading>
            <Text size="1" color="gray">
              {trip.aircraft_ident ?? "No tail number"}
              {trip.aircraft_type ? ` · ${trip.aircraft_type}` : ""}
            </Text>
          </Flex>
          <Flex direction="column" align="end" gap="2">
            <Flex direction="column" gap="1" style={{ minWidth: 140 }}>
              <Text as="label" size="1" color="gray" id={roleLabelId}>
                Role for this trip
              </Text>
              <Select.Root
                value={role ?? ""}
                onValueChange={(value) => setRole(value as LogbookRole)}
              >
                <Select.Trigger
                  aria-labelledby={roleLabelId}
                  placeholder="Choose PIC or SIC"
                />
                <Select.Content>
                  {ROLE_OPTIONS.map((option) => (
                    <Select.Item key={option.value} value={option.value}>
                      {option.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>
            <ConfirmTripButton tripId={trip.id} legCount={legs.length} role={role} />
          </Flex>
        </Flex>

        <Table.Root variant="ghost">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Route</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">Total</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">Night</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">Instrument</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">Landings</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">Role</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">PIC / SIC</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end"> </Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {legs.map((leg) => {
              const totalTime = Number(leg.block_hours ?? 0);
              // HIGH 5: draftPayloadForLeg deliberately leaves
              // instrument_actual_time and day_landings_full/touch_go
              // null/0 rather than guess a classification trip_legs never
              // recorded — correct, but this table used to render THOSE
              // always-zero proposal fields instead of the leg's own real
              // numbers, so a pilot reviewing 2.3 real instrument hours
              // and 4 real day landings saw "0.0" and "0" and confirmed.
              // Show the trip leg's own figures instead, marked with "*"
              // wherever a classification the logbook wants (actual vs
              // simulated instrument; full-stop vs touch-and-go day
              // landings) isn't in that number — never print a zero for a
              // fact the draft is refusing to assert.
              //
              // Since 20260810080000 the leg editor can capture the
              // actual/simulated instrument split and the full-stop count
              // directly, and draftPayloadForLeg maps those straight
              // across when present — so the "*" (and the confirmed
              // entry's real numbers) must follow whichever the leg
              // actually recorded, not always the legacy combined fields.
              const instrumentSplitRecorded =
                leg.instrument_actual_hours != null || leg.instrument_simulated_hours != null;
              const instrumentHours = instrumentSplitRecorded
                ? Number(leg.instrument_actual_hours ?? 0) + Number(leg.instrument_simulated_hours ?? 0)
                : Number(leg.instrument_hours ?? 0);
              const instrumentUnsplit = !instrumentSplitRecorded && instrumentHours > 0;
              const dayLandingsSplitMissing = !(leg.day_landings_full_stop ?? 0) && leg.day_landings > 0;
              const landingsTotal =
                Number(leg.day_landings) +
                Number(leg.night_landings_full_stop) +
                Number(leg.night_landings_touch_go);
              const picSicTime = role ? totalTime : null;
              return (
                <Table.Row key={leg.id}>
                  <Table.Cell>
                    <Text size="2" weight="medium">
                      {formatDate(leg.leg_date)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="2" color="gray">
                      {leg.from_icao ?? "—"} → {leg.to_icao ?? "—"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell justify="end">
                    <Text size="2" className="tnum">
                      {totalTime.toFixed(1)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell justify="end">
                    <Text size="2" color="gray" className="tnum">
                      {Number(leg.night_hours ?? 0).toFixed(1)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell justify="end">
                    <Text size="2" color="gray" className="tnum">
                      {instrumentHours.toFixed(1)}
                      {instrumentUnsplit ? "*" : ""}
                    </Text>
                  </Table.Cell>
                  <Table.Cell justify="end">
                    <Text size="2" color="gray" className="tnum">
                      {landingsTotal}
                      {dayLandingsSplitMissing ? "*" : ""}
                    </Text>
                  </Table.Cell>
                  <Table.Cell justify="end">
                    <Text size="2" color={role ? undefined : "amber"} className="tnum">
                      {role ?? "not set"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell justify="end">
                    <Text size="2" color="gray" className="tnum">
                      {picSicTime === null ? "—" : picSicTime.toFixed(1)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell justify="end">
                    <ConfirmLegButton
                      tripLegId={leg.id}
                      label={`${leg.from_icao ?? "?"} to ${leg.to_icao ?? "?"} on ${formatDate(leg.leg_date)}`}
                      role={role}
                    />
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>

        <Text size="1" color="gray">
          * marks a leg that recorded only the older combined field:
          instrument time as one total (not actual vs. simulated) or day
          landings with no full-stop count. The confirmed entry carries that
          the same way; classify it on the logbook entry after confirming.
          Unmarked instrument and landing figures already carry the split
          the leg itself recorded.
        </Text>
        <Text size="1" color="gray">
          These numbers come straight from the trip&rsquo;s legs. Fix a leg on
          the trip first if anything&rsquo;s wrong, then come back here. You can
          also edit any field on the logbook entry after confirming.
        </Text>
      </Flex>
    </Card>
  );
}
