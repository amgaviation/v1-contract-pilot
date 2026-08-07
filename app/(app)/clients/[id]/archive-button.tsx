"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertDialog, Box, Button, Flex, Text } from "@/components/ui";
import { setClientArchived } from "../actions";

/**
 * Archive / restore. Deliberately not a delete: `pilot.trips` references
 * a client ON DELETE RESTRICT, so a client who has ever flown is not
 * deletable — and shouldn't be, since that history is what the invoices
 * were built from.
 *
 * Only archiving is destructive enough to confirm — restoring a client
 * has no consequence worth interrupting for.
 */
export default function ArchiveButton({
  id,
  archived,
}: {
  id: string;
  archived: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justChanged, setJustChanged] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // The archive/restore action swaps which button is rendered rather than
  // navigating away, so a successful toggle would otherwise drop focus to
  // <body> as the old button unmounts. Move it to the button that replaces it.
  useEffect(() => {
    if (justChanged) {
      buttonRef.current?.focus();
      setJustChanged(false);
    }
  }, [archived, justChanged]);

  function setArchived(next: boolean) {
    startTransition(async () => {
      const result = await setClientArchived(id, next);
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setOpen(false);
      setJustChanged(true);
    });
  }

  return (
    <Box>
      {archived ? (
        <Button
          ref={buttonRef}
          variant="outline"
          disabled={pending}
          onClick={() => setArchived(false)}
        >
          {pending ? "Working…" : "Restore client"}
        </Button>
      ) : (
        <AlertDialog.Root open={open} onOpenChange={setOpen}>
          <AlertDialog.Trigger>
            <Button ref={buttonRef} variant="outline" color="red">
              Archive client
            </Button>
          </AlertDialog.Trigger>
          <AlertDialog.Content maxWidth="420px">
            <AlertDialog.Title>Archive this client?</AlertDialog.Title>
            <AlertDialog.Description size="2">
              Their trips and invoices are untouched — they just won&rsquo;t
              appear when you pick a client for new work. You can restore
              them any time.
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
              <Button
                variant="solid"
                color="red"
                disabled={pending}
                onClick={() => setArchived(true)}
              >
                {pending ? "Working…" : "Archive client"}
              </Button>
            </Flex>
          </AlertDialog.Content>
        </AlertDialog.Root>
      )}
    </Box>
  );
}
