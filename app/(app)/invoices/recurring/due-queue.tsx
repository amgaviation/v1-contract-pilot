"use client";

import { useState, useTransition } from "react";
import NextLink from "next/link";
import { AlertDialog, Button, Callout, Card, Flex, Link as RadixLink, Table, Text } from "@/components/ui";
import { ClockIcon } from "@radix-ui/react-icons";
import { formatCents, formatDate } from "@/lib/format";
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

export default function DueQueue({
  rows,
  hasActiveSchedules,
}: {
  rows: DueRow[];
  // "Every active schedule's periods are already created" is only true
  // when there IS an active schedule. With none, this queue is empty for
  // a completely different reason and that sentence is simply wrong.
  hasActiveSchedules: boolean;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [pendingAll, startAll] = useTransition();
  const [allError, setAllError] = useState<string | null>(null);
  const [allSummary, setAllSummary] = useState<string | null>(null);
  // Set only when generateAllDueRecurringInvoices reports the due count is
  // past CREATE_ALL_CONFIRM_THRESHOLD — see that action's own comment
  // (defect 7). Nothing has been created yet at this point.
  const [confirmInfo, setConfirmInfo] = useState<{ count: number; amountCents: number } | null>(null);

  const key = (r: DuePeriod) => `${r.schedule_id}:${r.period_start}`;
  const visible = rows.filter((r) => !dismissed.has(key(r)));

  function runGenerateAll(confirmed: boolean) {
    startAll(async () => {
      setAllError(null);
      setAllSummary(null);
      const result = await generateAllDueRecurringInvoices(confirmed);
      if (result.error) {
        setAllError(result.error);
        return;
      }
      if (result.needsConfirmation) {
        setConfirmInfo({ count: result.dueCount ?? 0, amountCents: result.dueAmountCents ?? 0 });
        return;
      }
      setConfirmInfo(null);
      setDismissed(new Set(rows.map(key)));
      setAllSummary(
        result.failed.length === 0
          ? `Created ${result.created} invoice${result.created === 1 ? "" : "s"}.`
          : `Created ${result.created} invoice${result.created === 1 ? "" : "s"}; ${result.failed.length} couldn't be created (${result.failed.join("; ")}).`
      );
    });
  }

  function handleCreateAll() {
    runGenerateAll(false);
  }

  function handleConfirmCreateAll() {
    runGenerateAll(true);
  }

  if (rows.length === 0) {
    return (
      <Card size="3">
        <Flex direction="column" align="center" gap="2" py="6">
          <Text size="4" weight="bold">
            {hasActiveSchedules ? "Nothing due right now" : "No schedules to fall due"}
          </Text>
          <Text size="2" color="gray" align="center">
            {hasActiveSchedules
              ? "Every active schedule’s periods up to today have already been created."
              : "This queue lists the periods an active recurring schedule owes you an invoice for. Set one up below and its first period shows up here."}
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

      <AlertDialog.Root open={confirmInfo !== null} onOpenChange={(open) => { if (!open) setConfirmInfo(null); }}>
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>Create {confirmInfo?.count ?? 0} invoices?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            {`This creates ${confirmInfo?.count ?? 0} draft invoices totaling `}
            <Text weight="medium" className="tnum">
              {formatCents(confirmInfo?.amountCents ?? 0)}
            </Text>
            {". That's more than usual for one click — double-check a schedule's first-bill date isn't further in the past than intended before continuing. Every invoice is still a draft you review before sending."}
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray" disabled={pendingAll}>
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <Button variant="solid" disabled={pendingAll} onClick={handleConfirmCreateAll}>
              {pendingAll ? "Creating…" : `Create ${confirmInfo?.count ?? 0} invoices`}
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

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
