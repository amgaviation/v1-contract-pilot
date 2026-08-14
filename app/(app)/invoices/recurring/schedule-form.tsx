"use client";

import { useActionState, useState, useTransition } from "react";
import NextLink from "next/link";
import {
  AlertDialog,
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Select,
  Table,
  Text,
  TextField,
} from "@/components/ui";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { centsToInput, formatCents, formatDate } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";
import {
  createRecurringSchedule,
  updateRecurringSchedule,
  setRecurringScheduleActive,
  deleteRecurringSchedule,
  type ScheduleFormState,
  type ScheduleEditState,
} from "./actions";

type ScheduleRow = Database["pilot"]["Tables"]["recurring_invoice_schedules"]["Row"];
export type ClientOption = { id: string; name: string };

const CADENCE_LABEL: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly" };

/** cents → the percent string a tax_rate_percent field shows ("825" → "8.25"). */
function bpsToPercentInput(bps: number): string {
  return bps === 0 ? "" : (bps / 100).toFixed(2).replace(/\.?0+$/, "");
}

const emptyCreateState: ScheduleFormState = { error: null, values: {} };
const emptyEditState: ScheduleEditState = { error: null };

/** `min` for the anchor_date input — a soft nudge, not a real bound (the
 * server never enforces this; see the input's own comment). Computed at
 * module load, not per-render, since it only needs day granularity. */
const FIVE_YEARS_AGO = (() => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 5);
  return d.toISOString().slice(0, 10);
})();

function AddScheduleCard({ clients }: { clients: ClientOption[] }) {
  const [state, formAction, pending] = useActionState(createRecurringSchedule, emptyCreateState);
  const v = state.values ?? {};
  // React 19 resets an uncontrolled form on every dispatch, error path
  // included — remounting the whole field block on the echoed values
  // (via `key`) picks up a rejected submission's text instead of losing
  // it, same pattern as expenses/mileage/mileage-form.tsx's AddEntryCard.
  const [clientId, setClientId] = useState(v.client_id ?? "");
  const [cadence, setCadence] = useState(v.cadence || "monthly");

  return (
    <Card size="3">
      <form action={formAction} key={JSON.stringify(v)}>
        <Text as="div" size="4" weight="bold" mb="3">
          New recurring schedule
        </Text>
        <Grid columns={{ initial: "1", md: "3" }} gap="3">
          <input type="hidden" name="client_id" value={clientId} />
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" id="new-client-label">
              Client
            </Text>
            <Select.Root value={clientId || undefined} onValueChange={setClientId}>
              <Select.Trigger aria-labelledby="new-client-label" placeholder="Choose a client" />
              <Select.Content>
                {clients.map((c) => (
                  <Select.Item key={c.id} value={c.id}>
                    {c.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>

          <input type="hidden" name="cadence" value={cadence} />
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" id="new-cadence-label">
              Cadence
            </Text>
            <Select.Root value={cadence} onValueChange={setCadence}>
              <Select.Trigger aria-labelledby="new-cadence-label" />
              <Select.Content>
                <Select.Item value="monthly">Monthly</Select.Item>
                <Select.Item value="quarterly">Quarterly</Select.Item>
              </Select.Content>
            </Select.Root>
          </Flex>

          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="new-anchor">
              First bill date
            </Text>
            <TextField.Root
              id="new-anchor"
              type="date"
              name="anchor_date"
              required
              // Helps the honest mistake only — a deliberately backdated
              // anchor still passes server-side (isDate is the real
              // validation; see actions.ts). The real guard against a
              // large backlog materializing in one click is the
              // create-all confirmation threshold in
              // generateAllDueRecurringInvoices (defect 7).
              min={FIVE_YEARS_AGO}
              defaultValue={v.anchor_date ?? ""}
            />
            <Text size="1" color="gray">
              A date further in the past can queue up many months of due invoices at once.
            </Text>
          </Flex>

          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="new-end">
              End date (optional)
            </Text>
            <TextField.Root id="new-end" type="date" name="end_date" defaultValue={v.end_date ?? ""} />
          </Flex>

          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="new-amount">
              Amount billed
            </Text>
            <TextField.Root
              id="new-amount"
              name="amount"
              required
              inputMode="decimal"
              placeholder="5000.00"
              defaultValue={v.amount ?? ""}
              className="tnum"
            />
          </Flex>

          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="new-tax">
              Tax rate % (optional)
            </Text>
            <TextField.Root
              id="new-tax"
              name="tax_rate_percent"
              inputMode="decimal"
              placeholder="0"
              defaultValue={v.tax_rate_percent ?? ""}
              className="tnum"
            />
          </Flex>

          <Box style={{ gridColumn: "1 / -1" }}>
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="new-description">
                Description (appears on the invoice line)
              </Text>
              <TextField.Root
                id="new-description"
                name="description"
                required
                placeholder="Monthly retainer"
                defaultValue={v.description ?? ""}
              />
            </Flex>
          </Box>
        </Grid>

        <Flex mt="3" role="alert" aria-live="polite">
          {state.error ? (
            <Text size="1" color="red">
              {state.error}
            </Text>
          ) : null}
        </Flex>
        <Flex mt="3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Add schedule"}
          </Button>
        </Flex>
      </form>
    </Card>
  );
}

function EditScheduleRow({ schedule, onDone }: { schedule: ScheduleRow; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(updateRecurringSchedule, emptyEditState);
  const v = state.values ?? {
    end_date: schedule.end_date ?? "",
    description: schedule.description,
    amount: centsToInput(schedule.amount_cents),
    tax_rate_percent: bpsToPercentInput(schedule.tax_rate_bps),
  };

  return (
    <Table.Row>
      <Table.Cell colSpan={6}>
        <form action={formAction} key={JSON.stringify(v)}>
          <input type="hidden" name="id" value={schedule.id} />
          <Grid columns={{ initial: "1", md: "4" }} gap="3">
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor={`edit-desc-${schedule.id}`}>
                Description
              </Text>
              <TextField.Root
                id={`edit-desc-${schedule.id}`}
                name="description"
                required
                defaultValue={v.description}
              />
            </Flex>
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor={`edit-amount-${schedule.id}`}>
                Amount
              </Text>
              <TextField.Root
                id={`edit-amount-${schedule.id}`}
                name="amount"
                required
                inputMode="decimal"
                defaultValue={v.amount}
                className="tnum"
              />
            </Flex>
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor={`edit-tax-${schedule.id}`}>
                Tax rate %
              </Text>
              <TextField.Root
                id={`edit-tax-${schedule.id}`}
                name="tax_rate_percent"
                inputMode="decimal"
                defaultValue={v.tax_rate_percent}
                className="tnum"
              />
            </Flex>
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor={`edit-end-${schedule.id}`}>
                End date
              </Text>
              <TextField.Root
                id={`edit-end-${schedule.id}`}
                type="date"
                name="end_date"
                defaultValue={v.end_date}
              />
            </Flex>
          </Grid>
          <Flex mt="2" role="alert" aria-live="polite">
            {state.error ? (
              <Text size="1" color="red">
                {state.error}
              </Text>
            ) : null}
          </Flex>
          <Flex mt="3" gap="2">
            <Button type="submit" size="1" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" size="1" variant="outline" onClick={onDone}>
              Cancel
            </Button>
          </Flex>
        </form>
      </Table.Cell>
    </Table.Row>
  );
}

function ScheduleRowView({
  schedule,
  clientName,
  editing,
  onEdit,
  onDone,
}: {
  schedule: ScheduleRow;
  clientName: string;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleToggle() {
    startTransition(async () => {
      setToggleError(null);
      const result = await setRecurringScheduleActive(schedule.id, !schedule.active);
      if (result.error) setToggleError(result.error);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      setDeleteError(null);
      const result = await deleteRecurringSchedule(schedule.id);
      if (result.error) setDeleteError(result.error);
      else setConfirmOpen(false);
    });
  }

  if (editing) {
    return <EditScheduleRow schedule={schedule} onDone={onDone} />;
  }

  return (
    <Table.Row>
      <Table.RowHeaderCell>
        <Text weight="medium">{clientName}</Text>
      </Table.RowHeaderCell>
      <Table.Cell>
        <Text color="gray">{schedule.description}</Text>
      </Table.Cell>
      <Table.Cell>
        <Text color="gray">{CADENCE_LABEL[schedule.cadence] ?? schedule.cadence}</Text>
      </Table.Cell>
      <Table.Cell justify="end">
        <Text weight="medium" className="tnum">
          {formatCents(schedule.amount_cents)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text color="gray">
          {formatDate(schedule.anchor_date)}
          {schedule.end_date ? ` to ${formatDate(schedule.end_date)}` : ""}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Flex gap="2" align="center" wrap="wrap">
          {schedule.active ? (
            <Badge color="green">Active</Badge>
          ) : (
            <Badge color="gray">Paused</Badge>
          )}
          <Button type="button" size="1" variant="soft" onClick={handleToggle} disabled={pending}>
            {schedule.active ? "Pause" : "Resume"}
          </Button>
          <Button type="button" size="1" variant="soft" onClick={onEdit} disabled={pending}>
            Edit
          </Button>
          <AlertDialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialog.Trigger>
              <Button type="button" size="1" variant="ghost" color="red" disabled={pending}>
                Delete
              </Button>
            </AlertDialog.Trigger>
            <AlertDialog.Content maxWidth="440px">
              <AlertDialog.Title>Delete this schedule?</AlertDialog.Title>
              <AlertDialog.Description size="2">
                {clientName}, {schedule.description} ({formatCents(schedule.amount_cents)}{" "}
                {CADENCE_LABEL[schedule.cadence]?.toLowerCase()}). Invoices already created from it
                are unaffected; this only stops future ones.
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
                  <Button variant="soft" color="gray" disabled={pending}>
                    Cancel
                  </Button>
                </AlertDialog.Cancel>
                <Button variant="solid" color="red" disabled={pending} onClick={handleDelete}>
                  {pending ? "Deleting…" : "Delete"}
                </Button>
              </Flex>
            </AlertDialog.Content>
          </AlertDialog.Root>
        </Flex>
        {toggleError ? (
          <Text as="div" size="1" color="red" mt="1">
            {toggleError}
          </Text>
        ) : null}
      </Table.Cell>
    </Table.Row>
  );
}

export default function ScheduleManager({
  schedules,
  clients,
}: {
  schedules: ScheduleRow[];
  clients: ClientOption[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const clientNames = new Map(clients.map((c) => [c.id, c.name]));

  return (
    <Flex direction="column" gap="4">
      <Callout.Root color="blue">
        <Callout.Icon>
          <InfoCircledIcon />
        </Callout.Icon>
        <Callout.Text>
          <Text as="div" size="2">
            A schedule never sends anything by itself. It only records a cadence. The app tells
            you when a period is due, and every invoice it creates is a draft you review before
            sending, the same as any other invoice.
          </Text>
        </Callout.Text>
      </Callout.Root>

      {clients.length === 0 ? (
        <Card size="3">
          <Flex direction="column" align="center" gap="3" py="5">
            <Text size="4" weight="bold">
              Add a client first
            </Text>
            <Text size="2" color="gray" align="center">
              A recurring schedule bills exactly one client: the owner, operator, or
              management company on a retainer or a committed-rate contract.
            </Text>
            <Button asChild>
              <NextLink href="/clients/new">Add a client</NextLink>
            </Button>
          </Flex>
        </Card>
      ) : (
        <AddScheduleCard clients={clients} />
      )}

      <Card size="3">
        {schedules.length === 0 ? (
          <Flex direction="column" align="center" gap="2" py="6">
            <Text size="4" weight="bold">
              No recurring schedules yet
            </Text>
            <Text size="2" color="gray" align="center">
              A schedule is for the billing that repeats on a cadence: a monthly retainer or a
              committed-rate contract you re-bill by hand today. It records the cadence only:
              every invoice it creates is a draft you review before sending.
              {clients.length === 0
                ? " Add a client above and this list fills in from there."
                : " Add one above and the periods it owes you show up in the queue at the top of this screen."}
            </Text>
            {clients.length === 0 ? (
              <Button asChild>
                <NextLink href="/clients/new">Add a client</NextLink>
              </Button>
            ) : (
              <Button asChild variant="outline">
                <NextLink href="/invoices">Back to invoices</NextLink>
              </Button>
            )}
          </Flex>
        ) : (
          <Table.Root variant="ghost">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Client</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Description</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Cadence</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Amount</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Term</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {schedules.map((schedule) => (
                <ScheduleRowView
                  key={schedule.id}
                  schedule={schedule}
                  clientName={clientNames.get(schedule.client_id) ?? "—"}
                  editing={editingId === schedule.id}
                  onEdit={() => setEditingId(schedule.id)}
                  onDone={() => setEditingId(null)}
                />
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </Card>
    </Flex>
  );
}
