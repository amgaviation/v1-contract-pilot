"use client";

import { useState, useTransition } from "react";
import {
  AlertDialog,
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Table,
  Text,
} from "@/components/ui";
import { formatCents, formatDate } from "@/lib/format";
import { deleteJournalEntry } from "./actions";

export type JournalLineView = {
  id: string;
  accountName: string;
  side: "debit" | "credit";
  amountCents: number;
};

export type JournalEntryView = {
  id: string;
  entryDate: string;
  memo: string;
  sourceType: string;
  lines: JournalLineView[];
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "manual",
  invoice_issued: "invoice",
  invoice_voided: "void",
  payment: "payment",
  payment_void_reclass: "held",
  expense: "expense",
  mileage: "mileage",
};

function EntryCard({ entry }: { entry: JournalEntryView }) {
  const [deleting, startDelete] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleDelete() {
    startDelete(async () => {
      setDeleteError(null);
      const result = await deleteJournalEntry(entry.id);
      if (result.error) setDeleteError(result.error);
      else setConfirmOpen(false);
    });
  }

  return (
    <Card size="2">
      <Flex justify="between" align="center" gap="3" wrap="wrap">
        <Flex gap="2" align="center" wrap="wrap">
          <Text size="2" weight="medium">
            {formatDate(entry.entryDate)}
          </Text>
          <Text size="2">{entry.memo}</Text>
          <Badge
            color={entry.sourceType === "manual" ? "blue" : "gray"}
            variant="soft"
          >
            {SOURCE_LABEL[entry.sourceType] ?? entry.sourceType}
          </Badge>
        </Flex>
        {entry.sourceType === "manual" ? (
          <AlertDialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialog.Trigger>
              <Button type="button" size="1" variant="ghost" color="red">
                Delete
              </Button>
            </AlertDialog.Trigger>
            <AlertDialog.Content maxWidth="420px">
              <AlertDialog.Title>Delete this journal entry?</AlertDialog.Title>
              <AlertDialog.Description size="2">
                {formatDate(entry.entryDate)}: {entry.memo}. Fixing a
                mistake means deleting and re-entering it. This
                can&rsquo;t be undone.
              </AlertDialog.Description>
              {deleteError ? (
                <Box mt="2">
                  <Text size="1" color="red" role="alert">
                    {deleteError}
                  </Text>
                </Box>
              ) : null}
              <Flex gap="3" mt="4" justify="end">
                <AlertDialog.Cancel>
                  <Button variant="soft" color="gray" disabled={deleting}>
                    Cancel
                  </Button>
                </AlertDialog.Cancel>
                <Button variant="solid" color="red" disabled={deleting} onClick={handleDelete}>
                  {deleting ? "Deleting…" : "Delete"}
                </Button>
              </Flex>
            </AlertDialog.Content>
          </AlertDialog.Root>
        ) : null}
      </Flex>
      <Table.Root variant="ghost" size="1">
        <Table.Body>
          {entry.lines.map((line) => (
            <Table.Row key={line.id}>
              <Table.Cell>
                <Text size="1" color="gray">
                  {line.accountName}
                </Text>
              </Table.Cell>
              <Table.Cell justify="end">
                <Text size="1" className="tnum">
                  {line.side === "debit" ? formatCents(line.amountCents) : ""}
                </Text>
              </Table.Cell>
              <Table.Cell justify="end">
                <Text size="1" className="tnum" color="gray">
                  {line.side === "credit" ? formatCents(line.amountCents) : ""}
                </Text>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Card>
  );
}

export default function JournalList({ entries }: { entries: JournalEntryView[] }) {
  if (entries.length === 0) {
    return (
      <Card size="3">
        <Flex direction="column" align="center" gap="2" py="6">
          <Text size="4" weight="bold">
            No journal entries yet
          </Text>
          <Text size="2" color="gray" align="center">
            Issue an invoice, record a payment, or log an expense, and it
            posts here automatically. You can also record a manual entry
            above.
          </Text>
        </Flex>
      </Card>
    );
  }
  return (
    <Flex direction="column" gap="3">
      {entries.map((entry) => (
        <EntryCard key={entry.id} entry={entry} />
      ))}
    </Flex>
  );
}
