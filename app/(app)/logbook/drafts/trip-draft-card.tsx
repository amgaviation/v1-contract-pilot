"use client";

import { useId, useState } from "react";
import NextLink from "next/link";
import { LCard, LTable, LTd, LTh } from "@/components/ledger";
import { LSelect } from "@/components/ledger/forms";
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
    <LCard>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col">
            <h3 className="text-h3 font-semibold">
              <NextLink href={`/trips/${trip.id}`} className="text-accent hover:underline">
                {formatDateRange(trip.starts_on, trip.ends_on)}
              </NextLink>
            </h3>
            <p className="text-caption text-ink-3">
              {trip.aircraft_ident ?? "No tail number"}
              {trip.aircraft_type ? ` · ${trip.aircraft_type}` : ""}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex min-w-[140px] flex-col gap-1">
              <label htmlFor={roleLabelId} className="text-caption text-ink-3">
                Role for this trip
              </label>
              <LSelect
                id={roleLabelId}
                aria-label="Role for this trip"
                value={role ?? ""}
                onChange={(e) => setRole((e.target.value || null) as LogbookRole | null)}
              >
                <option value="" disabled>
                  Choose PIC or SIC
                </option>
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </LSelect>
            </div>
            <ConfirmTripButton tripId={trip.id} legCount={legs.length} role={role} />
          </div>
        </div>

        <LTable>
          <caption>
            <span className="sr-only">{`Legs for the trip on ${formatDateRange(trip.starts_on, trip.ends_on)}`}</span>
          </caption>
          <thead>
            <tr>
              <LTh>Date</LTh>
              <LTh>Route</LTh>
              <LTh numeric>Total</LTh>
              <LTh numeric>Night</LTh>
              <LTh numeric>Instrument</LTh>
              <LTh numeric>Landings</LTh>
              <LTh numeric>Role</LTh>
              <LTh numeric>PIC / SIC</LTh>
              <LTh numeric> </LTh>
            </tr>
          </thead>
          <tbody>
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
                <tr key={leg.id}>
                  <th
                    scope="row"
                    className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                  >
                    {formatDate(leg.leg_date)}
                  </th>
                  <LTd>
                    <span className="text-ink-2">
                      {leg.from_icao ?? "—"} → {leg.to_icao ?? "—"}
                    </span>
                  </LTd>
                  <LTd numeric>{totalTime.toFixed(1)}</LTd>
                  <LTd numeric>
                    <span className="text-ink-2">{Number(leg.night_hours ?? 0).toFixed(1)}</span>
                  </LTd>
                  <LTd numeric>
                    <span className="text-ink-2">
                      {instrumentHours.toFixed(1)}
                      {instrumentUnsplit ? "*" : ""}
                    </span>
                  </LTd>
                  <LTd numeric>
                    <span className="text-ink-2">
                      {landingsTotal}
                      {dayLandingsSplitMissing ? "*" : ""}
                    </span>
                  </LTd>
                  <LTd numeric>
                    <span className={role ? "text-ink-2" : "text-warn"}>{role ?? "not set"}</span>
                  </LTd>
                  <LTd numeric>
                    <span className="text-ink-2">{picSicTime === null ? "—" : picSicTime.toFixed(1)}</span>
                  </LTd>
                  <LTd numeric>
                    <ConfirmLegButton
                      tripLegId={leg.id}
                      label={`${leg.from_icao ?? "?"} to ${leg.to_icao ?? "?"} on ${formatDate(leg.leg_date)}`}
                      role={role}
                    />
                  </LTd>
                </tr>
              );
            })}
          </tbody>
        </LTable>

        <p className="text-caption text-ink-3">
          * marks a leg that recorded only the older combined field:
          instrument time as one total (not actual vs. simulated) or day
          landings with no full-stop count. The confirmed entry carries that
          the same way; classify it on the logbook entry after confirming.
          Unmarked instrument and landing figures already carry the split
          the leg itself recorded.
        </p>
        <p className="text-caption text-ink-3">
          These numbers come straight from the trip&rsquo;s legs. Fix a leg on
          the trip first if anything&rsquo;s wrong, then come back here. You can
          also edit any field on the logbook entry after confirming.
        </p>
      </div>
    </LCard>
  );
}
