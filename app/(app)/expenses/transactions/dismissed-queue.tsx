"use client";

import { useState } from "react";
import { Badge, Box, Button, Flex, Table, Text } from "@/components/ui";
import { formatCents, formatDate } from "@/lib/format";
import { unignoreTransaction } from "./actions";

export type DismissedRow = {
  id: string;
  posted_on: string;
  description: string;
  amount_cents: number;
  /** 'ignored' can be undone; 'orphaned' (reviewed, expense since deleted) cannot — see unignoreTransaction's header. */
  kind: "ignored" | "orphaned";
};

/**
 * The other half of the review queue: rows a pilot dismissed, plus rows
 * whose expense was deleted out from under them (bank_transactions.expense_id
 * ON DELETE SET NULL — the schema calls this "a rare, visible" state, which
 * required this list to exist for it to actually be visible anywhere).
 *
 * Collapsed by default — the everyday queue above is /expenses/transactions'
 * whole point, and most pilots most of the time have nothing dismissed to
 * revisit.
 */
export default function DismissedQueue({ rows }: { rows: DismissedRow[] }) {
  const [open, setOpen] = useState(false);

  if (rows.length === 0) return null;

  return (
    <Box mt="4">
      <Button type="button" size="1" variant="ghost" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide" : "Show"} dismissed &amp; unrecoverable ({rows.length})
      </Button>
      {open ? (
        <Box mt="2" style={{ overflowX: "auto" }}>
          <Table.Root variant="surface">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Description</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Amount</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell></Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell></Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row) => (
                <DismissedRowItem key={row.id} row={row} />
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
      ) : null}
    </Box>
  );
}

function DismissedRowItem({ row }: { row: DismissedRow }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  const handleUndo = async () => {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("id", row.id);
    const result = await unignoreTransaction(fd);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setRestored(true);
  };

  return (
    <Table.Row>
      <Table.Cell className="tnum">{formatDate(row.posted_on)}</Table.Cell>
      <Table.Cell>{row.description}</Table.Cell>
      <Table.Cell className="tnum">{formatCents(Math.abs(row.amount_cents))}</Table.Cell>
      <Table.Cell>
        {row.kind === "orphaned" ? (
          <Badge color="gray">The expense this became was deleted</Badge>
        ) : (
          <Badge color="gray">Dismissed</Badge>
        )}
      </Table.Cell>
      <Table.Cell>
        {row.kind === "ignored" ? (
          restored ? (
            <Text size="1" color="gray">
              Back in the queue above.
            </Text>
          ) : (
            <Flex direction="column" gap="1" align="end">
              <Button type="button" size="1" variant="soft" onClick={handleUndo} disabled={pending}>
                {pending ? "Restoring…" : "Undo"}
              </Button>
              {error ? (
                <Text size="1" color="red">
                  {error}
                </Text>
              ) : null}
            </Flex>
          )
        ) : null}
      </Table.Cell>
    </Table.Row>
  );
}
