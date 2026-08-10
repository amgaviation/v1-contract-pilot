"use client";

import { useId } from "react";
import { TextField } from "@/components/ui";
import type { FleetOption } from "@/lib/fleet";

/**
 * The tail-number box, offering the pilot their own fleet.
 *
 * Shared by the trip form and the logbook entry form so both offer the
 * SAME list — a fleet that differs between two screens is worse than no
 * fleet. See lib/fleet.ts and
 * supabase/migrations/20260810110000_aircraft_registry.sql.
 *
 * A <datalist>, deliberately, not a <select>. A contract pilot regularly
 * flies an airframe they have never flown before and will not have
 * registered; the field has to keep accepting anything typed into it, and
 * a picker that made the fleet mandatory would be a worse box than the
 * plain one this replaces.
 */
export default function TailNumberField({
  id,
  name,
  fleet,
  defaultValue,
  placeholder,
  typeFieldId,
}: {
  id: string;
  name: string;
  fleet: FleetOption[];
  defaultValue?: string;
  placeholder?: string;
  /**
   * The aircraft-type input to fill in when a registered tail is chosen.
   * Only ever filled when it is EMPTY: a pilot who typed something into
   * it meant it, and this must never overwrite that.
   */
  typeFieldId?: string;
}) {
  const listId = useId();

  // The same normalisation pilot.aircraft's generated tail_key applies, so
  // typing "n-447sp" matches the registry row stored as "N447SP".
  // Strip then uppercase, in that order — see tailKey() in
  // app/(app)/logbook/aircraft/db.ts for why the other order is wrong.
  const normalise = (value: string) => value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

  function fillType(value: string) {
    if (!typeFieldId) return;
    const match = fleet.find((option) => normalise(option.tailNumber) === normalise(value));
    if (!match) return;
    const suggestion = match.typeDesignator ?? match.makeModel;
    if (!suggestion) return;
    const target = document.getElementById(typeFieldId);
    if (!(target instanceof HTMLInputElement)) return;
    if (target.value.trim() !== "") return;
    // Uncontrolled input: the DOM value is what the form posts, and React
    // has no state here to fight with.
    target.value = suggestion;
  }

  return (
    <>
      <TextField.Root
        id={id}
        name={name}
        list={fleet.length > 0 ? listId : undefined}
        placeholder={placeholder}
        autoCapitalize="characters"
        spellCheck={false}
        defaultValue={defaultValue}
        onChange={(event) => fillType(event.currentTarget.value)}
      />
      {fleet.length > 0 ? (
        <datalist id={listId}>
          {fleet.map((option) => (
            <option key={option.tailNumber} value={option.tailNumber}>
              {[option.typeDesignator, option.makeModel].filter(Boolean).join(" · ")}
            </option>
          ))}
        </datalist>
      ) : null}
    </>
  );
}
