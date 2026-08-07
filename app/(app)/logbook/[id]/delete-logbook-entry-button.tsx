"use client";

import { useState, useTransition } from "react";
import { AlertDialog, Button, Flex, Text } from "@radix-ui/themes";
import { deleteLogbookEntry } from "../actions";

export default function DeleteLogbookEntryButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function doDelete() {
    startTransition(async () => {
      // A successful delete redirects and never returns, so anything
      // that comes back is a failure worth showing. On failure we keep
      // the dialog open so focus stays on the still-enabled confirm
      // button instead of falling back to <body>.
      const result = await deleteLogbookEntry(id);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <Flex direction="column" align="end" gap="1">
      <AlertDialog.Root open={open} onOpenChange={setOpen}>
        <AlertDialog.Trigger>
          <Button variant="outline" color="red">
            Delete entry
          </Button>
        </AlertDialog.Trigger>
        <AlertDialog.Content maxWidth="450px">
          <AlertDialog.Title>Delete this logbook entry?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            This can&rsquo;t be undone.
          </AlertDialog.Description>
          {error ? (
            <Text size="1" color="red" role="alert" mt="2">
              {error}
            </Text>
          ) : null}
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray" disabled={pending}>
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <Button variant="solid" color="red" disabled={pending} onClick={doDelete}>
              {pending ? "Deleting…" : "Delete entry"}
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  );
}
