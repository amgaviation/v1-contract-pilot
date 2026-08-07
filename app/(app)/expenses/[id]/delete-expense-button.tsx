"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertDialog, Box, Button, Flex, Text } from "@radix-ui/themes";
import { deleteExpense } from "../actions";

export default function DeleteExpenseButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirmDelete() {
    startTransition(async () => {
      const result = await deleteExpense(id);
      if (result.error) {
        // Keep the dialog open on failure so focus stays on the still-
        // enabled confirm button instead of falling back to <body>.
        setError(result.error);
        return;
      }
      // The action doesn't redirect — it can't, since it also has to
      // report a failure back here — so navigation is this component's
      // job once the delete lands.
      router.push("/expenses");
    });
  }

  return (
    <Flex direction="column" align="end" gap="2">
      <AlertDialog.Root open={open} onOpenChange={setOpen}>
        <AlertDialog.Trigger>
          <Button variant="outline" color="red">
            Delete expense
          </Button>
        </AlertDialog.Trigger>
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>Delete this expense?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            This removes the expense and its receipt. This can&rsquo;t be undone.
          </AlertDialog.Description>
          {error ? (
            <Box mt="2" role="alert">
              <Text size="1" color="red">
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
            <Button variant="solid" color="red" disabled={pending} onClick={confirmDelete}>
              {pending ? "Deleting…" : "Delete expense"}
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  );
}
