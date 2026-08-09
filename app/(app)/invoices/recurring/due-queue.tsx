"use client";

import { useState, useTransition } from "react";
import NextLink from "next/link";
import { Button, Callout, Card, Flex, Link as RadixLink, Table, Text } from "@/components/ui";
import { ClockIcon } from "@radix-ui/react-icons";
import { formatDate } from "@/lib/format";
import { generateRecurringInvoice, generateAllDueRecurringInvoices, type DuePeriod } from "./actions";

export type DueRow = DuePeriod & { client_name: string; description: string };

function CreateOneButton({ row, onDone }: { row: DueRow; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCreate() {
    startTransition(async () => {
      setError(null);
      const result = await generateRecurringInvoice(row.schedule_id, row.period_start);
      if (result.error) setError(result.error);
      else onDone();
    });
  }

  return (
    <Flex direction="column" align="end" gap="1">
      <Button type="button" size="1" onClick={handleCreate} disabled={pending}>
        {pending ? "Creating…" : "Create"}
      </Button>
      {error ? (
        <Text size="1" color="red" role="alert">
          {error}
        </Text>
      ) : null}
    </Flex>
  );
}

export default function DueQueue({ rows }: { rows: DueRow[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [pendingAll, startAll] = useTransition();
  const [allError, setAllError] = useState<string | null>(null);
  const [allSummary, setAllSummary] = useState<string | null>(null);

  const key = (r: DuePeriod) => `${r.schedule_id}:${r.period_start}`;
  const visible = rows.filter((r) => !dismissed.has(key(r)));

  function handleCreateAll() {
    startAll(async () => {
      setAllError(null);
      setAllSummary(null);
      const result = await generateAllDueRecurringInvoices();
      if (result.error) {
        setAllError(result.error);
        return;
      }
      setDismissed(new Set(rows.map(key)));
      setAllSummary(
        result.failed.length === 0
          ? `Created ${result.created} invoice${result.created === 1 ? "" : "s"}.`
          : `Created ${result.created} invoice${result.created === 1 ? "" : "s"}; ${result.failed.length} couldn't be created (${result.failed.join("; ")}).`
      );
    });
  }

  if (rows.length === 0) {
    return (
      <Card size="3">
        <Flex direction="column" align="center" gap="2" py="6">
          <Text size="4" weight="bold">
            Nothing due right now
          </Text>
          <Text size="2" color="gray" align="center">
            Every active schedule&rsquo;s periods up to today have already been created.
          </Text>
        </Flex>
      </Card>
    );
  }

  return (
    <Card size="3">
      <Flex justify="between" align="center" mb="3" wrap="wrap" gap="2">
        <Flex align="center" gap="2">
          <ClockIcon />
          <Text weight="bold">
            {visible.length} due to create
          </Text>
        </Flex>
        <Button type="button" size="1" variant="soft" onClick={handleCreateAll} disabled={pendingAll || visible.length === 0}>
          {pendingAll ? "Creating…" : "Create all due"}
        </Button>
      </Flex>

      {allError ? (
        <Callout.Root color="red" mb="3">
          <Callout.Text>{allError}</Callout.Text>
        </Callout.Root>
      ) : null}
      {allSummary ? (
        <Callout.Root color="green" mb="3">
          <Callout.Text>
            {allSummary}{" "}
            <RadixLink asChild>
              <NextLink href="/invoices">View invoices</NextLink>
            </RadixLink>
          </Callout.Text>
        </Callout.Root>
      ) : null}

      {visible.length === 0 ? null : (
        <Table.Root variant="ghost">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Client</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Description</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Period</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Due</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {visible.map((row) => (
              <Table.Row key={key(row)}>
                <Table.RowHeaderCell>
                  <Text weight="medium">{row.client_name}</Text>
                </Table.RowHeaderCell>
                <Table.Cell>
                  <Text color="gray">{row.description}</Text>
                </Table.Cell>
                <Table.Cell>
                  <Text color="gray">
                    {new Date(`${row.period_start}T00:00:00Z`).toLocaleDateString("en-US", {
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text color="gray" className="tnum">
                    {formatDate(row.due_on)}
                  </Text>
                </Table.Cell>
                <Table.Cell justify="end">
                  <CreateOneButton row={row} onDone={() => setDismissed((d) => new Set(d).add(key(row)))} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </Card>
  );
}
