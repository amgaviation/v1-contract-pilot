"use client";

import { useState, useTransition } from "react";
import { AlertDialog, Box, Button, Flex, Text } from "@/components/ui";
import { deleteTrip } from "../actions";

/**
 * Delete, not archive — a trip has no archived state, and an
 * accidentally-logged trip should leave nothing behind. Disabled once the
 * trip has been invoiced: the invoice's lines reference it, and Phase 5's
 * triggers refuse to let billed work vanish out from under a document
 * that has already gone to a client.
 */
export default function DeleteTripButton({
  id,
  disabled,
}: {
  id: string;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    startTransition(async () => {
      // A successful delete redirects and never returns, so anything
      // that comes back is a failure worth showing. On failure we keep
      // the dialog open (rather than closing it and disabling the
      // trigger) so keyboard focus stays on the still-enabled confirm
      // button instead of falling back to <body>.
      const result = await deleteTrip(id);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <Flex direction="column" align="end">
      <AlertDialog.Root open={open} onOpenChange={setOpen}>
        <AlertDialog.Trigger>
          <Button
            variant="outline"
            color="red"
            disabled={disabled}
            title={disabled ? "This trip has been invoiced and can't be deleted." : undefined}
          >
            Delete trip
          </Button>
        </AlertDialog.Trigger>
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>Delete this trip?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            This deletes the trip, its legs, and its day grid. The billing
            record goes with it. Expenses filed against it stay in your
            expense list but lose their trip link. This can&rsquo;t be
            undone.
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
              {pending ? "Deleting…" : "Delete trip"}
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  );
}
