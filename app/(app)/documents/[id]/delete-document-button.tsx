"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertDialog, Button, Flex, Text } from "@/components/ui";
import { deleteDocument } from "../actions";

export default function DeleteDocumentButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function doDelete() {
    startTransition(async () => {
      const result = await deleteDocument(id);
      if (result.error) {
        // Keep the dialog open on failure so focus stays on the still-
        // enabled confirm button instead of falling back to <body>.
        setError(result.error);
        return;
      }
      // The action doesn't redirect — it can't, since it also has to
      // report a failure back here — so navigation is this component's
      // job once the delete lands.
      router.push("/documents");
    });
  }

  return (
    <Flex direction="column" align="end" gap="1">
      <AlertDialog.Root open={open} onOpenChange={setOpen}>
        <AlertDialog.Trigger>
          <Button variant="outline" color="red">
            Delete document
          </Button>
        </AlertDialog.Trigger>
        <AlertDialog.Content maxWidth="450px">
          <AlertDialog.Title>Delete this document?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            This deletes the document and its attached file. This can&rsquo;t be undone.
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
              {pending ? "Deleting…" : "Delete document"}
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  );
}
