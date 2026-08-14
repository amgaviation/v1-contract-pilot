"use client";

import { useActionState, useState, useTransition } from "react";
import {
  Badge,
  Button,
  Card,
  Flex,
  Select,
  Table,
  Text,
  TextField,
} from "@/components/ui";
import { formatCents } from "@/lib/format";
import {
  KIND_LABEL,
  KIND_ORDER,
  type ChartKind,
  type LedgerBalanceRow,
  presentedBalanceCents,
} from "./ledger-lib";
import {
  createChartAccount,
  renameChartAccount,
  setChartAccountArchived,
  type ChartFormState,
} from "./actions";

const initialState: ChartFormState = { error: null };

function AddAccountForm() {
  const [state, formAction, pending] = useActionState(createChartAccount, initialState);
  const values = state.values ?? { name: "", kind: "expense" };

  return (
    <Card size="3">
      <form action={formAction} key={JSON.stringify(values)}>
        <Text as="div" size="3" weight="bold" mb="2">
          Add an account
        </Text>
        <Flex gap="3" align="end" wrap="wrap">
          <Flex direction="column" gap="1" flexGrow="1">
            <Text as="label" size="2" weight="medium" htmlFor="chart-add-name">
              Name
            </Text>
            <TextField.Root
              id="chart-add-name"
              name="name"
              required
              placeholder="e.g. Simulator rental income"
              defaultValue={values.name}
            />
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" id="chart-add-kind-label">
              Type
            </Text>
            <Select.Root name="kind" defaultValue={values.kind || "expense"}>
              <Select.Trigger aria-labelledby="chart-add-kind-label" />
              <Select.Content>
                {KIND_ORDER.map((kind) => (
                  <Select.Item key={kind} value={kind}>
                    {KIND_LABEL[kind]}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>
          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add account"}
          </Button>
        </Flex>
        <Flex mt="2" role="alert" aria-live="polite">
          {state.error ? (
            <Text size="1" color="red">
              {state.error}
            </Text>
          ) : null}
        </Flex>
        <Text as="div" size="1" color="gray" mt="2">
          The type can&rsquo;t change later. Archive and re-add the account
          if it was wrong. Built-in accounts can be renamed but not
          archived: they&rsquo;re where your invoices, payments, expenses,
          and mileage post automatically.
        </Text>
      </form>
    </Card>
  );
}

function AccountRow({ row }: { row: LedgerBalanceRow }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(renameChartAccount, initialState);
  const [archiving, startArchive] = useTransition();
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const balance = presentedBalanceCents(row.kind, row.balance_cents);

  function toggleArchive() {
    startArchive(async () => {
      setArchiveError(null);
      const result = await setChartAccountArchived(row.chart_account_id, !row.archived);
      if (result.error) setArchiveError(result.error);
    });
  }

  return (
    <Table.Row>
      <Table.RowHeaderCell>
        {editing ? (
          <form
            action={(formData) => {
              formData.set("id", row.chart_account_id);
              return formAction(formData);
            }}
          >
            <Flex gap="2" align="center">
              <TextField.Root
                name="name"
                required
                defaultValue={state.values?.name ?? row.name}
                aria-label={`Rename ${row.name}`}
              />
              <Button type="submit" size="1" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
              <Button type="button" size="1" variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </Flex>
            {state.error ? (
              <Text as="div" size="1" color="red" role="alert" mt="1">
                {state.error}
              </Text>
            ) : null}
          </form>
        ) : (
          <Flex gap="2" align="center">
            <Text weight="medium">{row.name}</Text>
            {row.system_key ? (
              <Badge color="gray" variant="soft">
                built-in
              </Badge>
            ) : null}
            {row.archived ? (
              <Badge color="gray" variant="outline">
                archived
              </Badge>
            ) : null}
          </Flex>
        )}
      </Table.RowHeaderCell>
      <Table.Cell justify="end">
        <Text className="tnum" color={balance < 0 ? "red" : undefined}>
          {formatCents(balance)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Flex gap="2" justify="end">
          {!editing ? (
            <Button type="button" size="1" variant="soft" onClick={() => setEditing(true)}>
              Rename
            </Button>
          ) : null}
          {!row.system_key ? (
            <Button
              type="button"
              size="1"
              variant="ghost"
              color={row.archived ? undefined : "red"}
              disabled={archiving}
              onClick={toggleArchive}
            >
              {archiving ? "…" : row.archived ? "Unarchive" : "Archive"}
            </Button>
          ) : null}
        </Flex>
        {archiveError ? (
          <Text as="div" size="1" color="red" role="alert" mt="1">
            {archiveError}
          </Text>
        ) : null}
      </Table.Cell>
    </Table.Row>
  );
}

export default function ChartManager({ rows }: { rows: LedgerBalanceRow[] }) {
  const byKind = new Map<ChartKind, LedgerBalanceRow[]>();
  for (const kind of KIND_ORDER) byKind.set(kind, []);
  for (const row of rows) byKind.get(row.kind)?.push(row);

  return (
    <Flex direction="column" gap="4">
      <AddAccountForm />
      {KIND_ORDER.map((kind) => {
        const kindRows = (byKind.get(kind) ?? []).sort((a, b) =>
          a.name.localeCompare(b.name)
        );
        if (kindRows.length === 0) return null;
        return (
          <Card size="3" key={kind}>
            <Text as="div" size="3" weight="bold" mb="2">
              {KIND_LABEL[kind]}
            </Text>
            <Table.Root variant="ghost">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Account</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell justify="end">Balance</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {kindRows.map((row) => (
                  <AccountRow key={row.chart_account_id} row={row} />
                ))}
              </Table.Body>
            </Table.Root>
          </Card>
        );
      })}
    </Flex>
  );
}
