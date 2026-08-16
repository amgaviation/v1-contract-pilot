"use client";

import { useState, useTransition } from "react";
import { LButton } from "@/components/ledger";
import { LSelect } from "@/components/ledger/forms";
import { fileExpense } from "./actions";

export type QueueRow = {
  id: string;
  label: string;
  detail: string;
  tripId: string | null;
};

export type QueueTrip = { id: string; label: string };

// The sentinel stands in for "no trip chosen" in this component's own
// local state only (fileExpense takes tripId as a plain argument, not a
// FormData field, so there is no name to preserve here — just the "" it
// expects for "no trip").
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
    <li className="py-3">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <p className="font-medium text-ink">{row.label}</p>
          <p className="text-caption text-ink-3">{row.detail}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-56">
            <LSelect
              aria-label={`Trip for ${row.label}`}
              value={tripId}
              onChange={(e) => setTripId(e.target.value)}
            >
              <option value={NO_TRIP}>No trip</option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.label}
                </option>
              ))}
            </LSelect>
          </div>

          <LButton
            type="button"
            variant="outline"
            size="sm"
            // Rebill needs a trip — the database refuses the pair
            // outright, so the control refuses it first.
            disabled={pending || tripId === NO_TRIP}
            onClick={() => file("rebill")}
            aria-label={`Rebill ${row.label} to the client`}
          >
            Rebill
          </LButton>
          <LButton
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => file("deduct")}
            aria-label={`Keep ${row.label} as a deduction`}
          >
            Deduct
          </LButton>
        </div>
      </div>

      {error ? (
        <p className="mt-2 text-caption font-medium text-crit" role="alert">
          {error}
        </p>
      ) : null}
    </li>
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
    <ul className="m-0 list-none divide-y divide-hair p-0">
      {rows.map((row) => (
        <QueueItem key={row.id} row={row} trips={trips} />
      ))}
    </ul>
  );
}
