"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button, Flex, Text } from "@/components/ui";
import { confirmLegDraft, confirmTripDrafts } from "../actions";
import type { LogbookRole } from "../db";

/**
 * The one and only UI path that writes a source='trip' logbook_entries
 * row. Both buttons re-read the trip/leg on the server before inserting
 * (see actions.ts) — this component just triggers that and shows the
 * result; it never sends flight numbers of its own.
 *
 * `role` is required and comes from the pilot's explicit choice on the
 * drafts screen (trip-draft-card.tsx) — both buttons are disabled while
 * it is null so a click can never write an unasserted PIC/SIC role. See
 * db.ts's draftPayloadForLeg comment for why this used to default to PIC.
 */
export function ConfirmLegButton({
  tripLegId,
  label,
  role,
}: {
  tripLegId: string;
  label: string;
  role: LogbookRole | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const doneRef = useRef<HTMLSpanElement>(null);

  // The button unmounts once confirmed, which would otherwise drop
  // keyboard focus to <body>. Move it to the confirmation message instead.
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  if (done) {
    return (
      <Text ref={doneRef} tabIndex={-1} size="1" color="green" weight="bold">
        Confirmed
      </Text>
    );
  }

  return (
    <Flex direction="column" align="end" gap="1">
      <Button
        variant="outline"
        size="1"
        disabled={pending || !role}
        title={role ? undefined : "Pick a role for this trip first"}
        aria-label={`Confirm leg ${label}`}
        onClick={() => {
          if (!role) return;
          startTransition(async () => {
            const result = await confirmLegDraft(tripLegId, role);
            if (result.error) setError(result.error);
            else setDone(true);
          });
        }}
      >
        {pending ? "Confirming…" : "Confirm"}
      </Button>
      {error ? (
        <Text size="1" color="red" role="alert">
          {error}
        </Text>
      ) : null}
    </Flex>
  );
}

export function ConfirmTripButton({
  tripId,
  legCount,
  role,
}: {
  tripId: string;
  legCount: number;
  role: LogbookRole | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const doneRef = useRef<HTMLSpanElement>(null);

  // The button unmounts once confirmed, which would otherwise drop
  // keyboard focus to <body>. Move it to the confirmation message instead.
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  if (done) {
    return (
      <Text ref={doneRef} tabIndex={-1} size="1" color="green" weight="bold">
        All confirmed
      </Text>
    );
  }

  return (
    <Flex direction="column" gap="1">
      <Button
        size="1"
        disabled={pending || !role}
        title={role ? undefined : "Pick a role for this trip first"}
        aria-label={`Confirm all ${legCount} leg${legCount === 1 ? "" : "s"}`}
        onClick={() => {
          if (!role) return;
          startTransition(async () => {
            const result = await confirmTripDrafts(tripId, role);
            if (result.error) setError(result.error);
            else setDone(true);
          });
        }}
      >
        {pending ? "Confirming…" : `Confirm all ${legCount} leg${legCount === 1 ? "" : "s"}`}
      </Button>
      {error ? (
        <Text size="1" color="red" role="alert">
          {error}
        </Text>
      ) : null}
    </Flex>
  );
}
