"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  AlertDialog,
  Box,
  Button,
  Checkbox,
  Flex,
  Table,
  Text,
  TextField,
  Select,
} from "@/components/ui";
import { formatCents, centsToInput, formatDate } from "@/lib/format";
import {
  addInvoiceLine,
  addRebillExpenseLine,
  deleteInvoiceLine,
  updateInvoiceLine,
  type LineFormState,
  type LineFormValues,
} from "../actions";
import { categoryLabel } from "../labels";

export type LineRow = {
  id: string;
  invoice_id: string;
  line_type: "flight_day" | "travel_day" | "per_diem" | "reimbursable_expense" | "cancellation_fee" | "other";
  description: string;
  quantity: number;
  unit_amount_cents: number;
  amount_cents: number;
  taxable: boolean;
  trip_id: string | null;
  expense_id: string | null;
};

export type RebillableExpense = {
  id: string;
  trip_id: string | null;
  category: string;
  vendor: string | null;
  amount_cents: number;
  incurred_on: string;
};

const LINE_TYPE_LABEL: Record<string, string> = {
  flight_day: "Flight day",
  travel_day: "Travel day",
  per_diem: "Per diem",
  reimbursable_expense: "Rebilled expense",
  cancellation_fee: "Cancellation fee",
  other: "Other",
};

const MANUAL_LINE_TYPES = [
  { value: "flight_day", label: "Flight day" },
  { value: "travel_day", label: "Travel day" },
  { value: "per_diem", label: "Per diem" },
  { value: "cancellation_fee", label: "Cancellation fee" },
  { value: "other", label: "Other" },
];

const initialLineState: LineFormState = { error: null };

export default function LinesEditor({
  invoiceId,
  lines,
  editable,
  rebillable,
}: {
  invoiceId: string;
  lines: LineRow[];
  editable: boolean;
  rebillable: RebillableExpense[];
}) {
  if (lines.length === 0 && !editable) {
    return <Text color="gray">No line items.</Text>;
  }

  return (
    <Box>
      <Table.Root variant="ghost">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>Type</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Description</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell justify="end">Qty</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell justify="end">Unit</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell justify="end">Amount</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Taxable</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {lines.map((line) =>
            editable ? (
              <EditableRow key={line.id} invoiceId={invoiceId} line={line} />
            ) : (
              <ReadOnlyRow key={line.id} line={line} />
            )
          )}
        </Table.Body>
      </Table.Root>

      {editable ? (
        <>
          {rebillable.length > 0 ? (
            <Box mt="5">
              <Text weight="bold">Rebillable expenses</Text>
              <Flex direction="column" gap="2" mt="2">
                {rebillable.map((expense) => (
                  <RebillRow key={expense.id} invoiceId={invoiceId} expense={expense} />
                ))}
              </Flex>
            </Box>
          ) : null}

          <Box mt="5">
            <Text weight="bold">Add a line</Text>
            <AddLineForm invoiceId={invoiceId} />
          </Box>
        </>
      ) : null}
    </Box>
  );
}

function ReadOnlyRow({ line }: { line: LineRow }) {
  return (
    <Table.Row>
      <Table.Cell>
        <Text color="gray">{LINE_TYPE_LABEL[line.line_type]}</Text>
      </Table.Cell>
      <Table.Cell>
        <Text>{line.description}</Text>
      </Table.Cell>
      <Table.Cell justify="end">
        <Text className="tnum">{line.quantity}</Text>
      </Table.Cell>
      <Table.Cell justify="end">
        <Text className="tnum">{formatCents(line.unit_amount_cents)}</Text>
      </Table.Cell>
      <Table.Cell justify="end">
        <Text weight="medium" className="tnum">
          {formatCents(line.amount_cents)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text color="gray">{line.taxable ? "Yes" : "No"}</Text>
      </Table.Cell>
      <Table.Cell />
    </Table.Row>
  );
}

function EditableRow({ invoiceId, line }: { invoiceId: string; line: LineRow }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateInvoiceLine, initialLineState);
  const [deletePending, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!editing) {
    return (
      <Table.Row>
        <Table.Cell>
          <Text color="gray">{LINE_TYPE_LABEL[line.line_type]}</Text>
        </Table.Cell>
        <Table.Cell>
          <Text>{line.description}</Text>
        </Table.Cell>
        <Table.Cell justify="end">
          <Text className="tnum">{line.quantity}</Text>
        </Table.Cell>
        <Table.Cell justify="end">
          <Text className="tnum">{formatCents(line.unit_amount_cents)}</Text>
        </Table.Cell>
        <Table.Cell justify="end">
          <Text weight="medium" className="tnum">
            {formatCents(line.amount_cents)}
          </Text>
        </Table.Cell>
        <Table.Cell>
          <Text color="gray">{line.taxable ? "Yes" : "No"}</Text>
        </Table.Cell>
        <Table.Cell justify="end">
          <Flex gap="3" justify="end">
            <Button
              variant="ghost"
              size="1"
              aria-label={`Edit — ${line.description}`}
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
            <AlertDialog.Root>
              <AlertDialog.Trigger>
                <Button
                  variant="ghost"
                  color="red"
                  size="1"
                  disabled={deletePending}
                  aria-label={`Remove — ${line.description}`}
                >
                  {deletePending ? "Removing…" : "Remove"}
                </Button>
              </AlertDialog.Trigger>
              <AlertDialog.Content maxWidth="420px">
                <AlertDialog.Title>Remove this line?</AlertDialog.Title>
                <AlertDialog.Description size="2">
                  This removes the line from the invoice. This can&rsquo;t be undone.
                </AlertDialog.Description>
                <Flex gap="3" mt="4" justify="end">
                  <AlertDialog.Cancel>
                    <Button variant="soft" color="gray">
                      Cancel
                    </Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action>
                    <Button
                      variant="solid"
                      color="red"
                      onClick={() => {
                        startDelete(async () => {
                          const result = await deleteInvoiceLine(line.id, invoiceId);
                          setDeleteError(result?.error ?? null);
                        });
                      }}
                    >
                      Remove
                    </Button>
                  </AlertDialog.Action>
                </Flex>
              </AlertDialog.Content>
            </AlertDialog.Root>
          </Flex>
          {deleteError ? (
            <Text as="div" size="1" color="red" role="alert">
              {deleteError}
            </Text>
          ) : null}
        </Table.Cell>
      </Table.Row>
    );
  }

  // A rejected submit must show and re-post what the pilot typed, not the
  // line's stored (pre-edit) values — React 19 resets an uncontrolled form
  // on every action dispatch, error path included, so the echo has to come
  // from the action's returned `state.values`, falling back to the stored
  // row only when there's no submission to echo yet.
  // A rejected edit must show what the pilot typed, not the stored row.
  // React 19 resets an uncontrolled form on every dispatch including the
  // error path, so the values are re-seeded from the action's echo and fall
  // back to the stored line only on first render.
  const submitted = state.values;
  // Keyed on LineFormValues rather than `string`, so a typo in a field
  // name is a compile error instead of a silently-undefined echo.
  const echoed = (key: keyof LineFormValues, fallback: string) =>
    submitted?.[key] ?? fallback;
  // The checkbox needs its own echo, not `echoed()`: an UNCHECKED checkbox
  // posts no `taxable` field at all, so `submitted.taxable` is `undefined`
  // for two different reasons — "no submission yet" (first render) and
  // "submitted, but unchecked" (rejected resubmit). Those must not
  // collapse to the same fallback, or a pilot who unchecks Taxable and
  // then hits a validation error on another field watches it silently
  // re-check on the error render. `submitted` itself (the object) is only
  // present once a submission has happened, so its presence disambiguates:
  // present + no "taxable" key -> unchecked; absent -> nothing submitted
  // yet, fall back to the stored row.
  const taxableChecked = submitted ? submitted.taxable === "on" : line.taxable;

  return (
    <Table.Row>
      <Table.Cell colSpan={7}>
        <form action={formAction}>
          <Flex gap="3" align="start" wrap="wrap">
            <input type="hidden" name="id" value={line.id} />
            <input type="hidden" name="invoice_id" value={invoiceId} />
            <Box style={{ flex: "1 1 220px" }}>
              <Text as="label" size="1" color="gray" htmlFor={`description-${line.id}`}>
                Description
              </Text>
              <TextField.Root
                id={`description-${line.id}`}
                name="description"
                placeholder="Description"
                defaultValue={echoed("description", line.description)}
                size="2"
              />
            </Box>
            <Box style={{ width: "90px" }}>
              <Text as="label" size="1" color="gray" htmlFor={`quantity-${line.id}`}>
                Qty
              </Text>
              <TextField.Root
                id={`quantity-${line.id}`}
                name="quantity"
                placeholder="Qty"
                defaultValue={echoed("quantity", String(line.quantity))}
                size="2"
              />
            </Box>
            <Box style={{ width: "120px" }}>
              <Text as="label" size="1" color="gray" htmlFor={`unit_amount-${line.id}`}>
                Unit (USD)
              </Text>
              <TextField.Root
                id={`unit_amount-${line.id}`}
                name="unit_amount"
                placeholder="Unit (USD)"
                defaultValue={echoed("unit_amount", centsToInput(line.unit_amount_cents))}
                size="2"
              />
            </Box>
            <Flex align="center" gap="2" asChild>
              <label>
                <Checkbox name="taxable" defaultChecked={taxableChecked} />
                <Text size="1">Taxable</Text>
              </label>
            </Flex>
            <Flex gap="2">
              <Button type="submit" size="2" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                variant="outline"
                color="gray"
                size="2"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </Flex>
            {state.error ? (
              <Text size="1" color="red" style={{ width: "100%" }} role="alert">
                {state.error}
              </Text>
            ) : null}
          </Flex>
        </form>
      </Table.Cell>
    </Table.Row>
  );
}

function AddLineForm({ invoiceId }: { invoiceId: string }) {
  const [state, formAction, pending] = useActionState(addInvoiceLine, initialLineState);
  // Same echo as above: the action returns what was submitted so a
  // rejected add re-renders the pilot's entry rather than an empty form.
  const submitted = state.values;
  // Same disambiguation as EditableRow's taxableChecked: `submitted`
  // present but no "taxable" key means "submitted, box was unchecked",
  // not "no submission yet" — the two must not collapse to the same
  // default (true) or an unchecked box silently re-checks itself on a
  // rejected add.
  const taxableChecked = submitted ? submitted.taxable === "on" : true;
  // Same Select.Root uncontrolled-bubble-input issue as elsewhere: `name`
  // dropped, real value posted from a controlled hidden input so a
  // rejected add doesn't silently revert the line type to "Other".
  const [lineType, setLineType] = useState(() =>
    submitted?.line_type !== undefined ? String(submitted.line_type) : "other"
  );
  useEffect(() => {
    if (submitted?.line_type !== undefined) setLineType(String(submitted.line_type));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  return (
    <form action={formAction}>
      <Flex mt="2" gap="3" align="start" wrap="wrap">
        <input type="hidden" name="invoice_id" value={invoiceId} />
        <Box style={{ width: "160px" }}>
          <Text as="label" size="1" color="gray" id="add-line-type-label">
            Type
          </Text>
          <Select.Root value={lineType} onValueChange={setLineType}>
            <Select.Trigger aria-labelledby="add-line-type-label" />
            <Select.Content>
              {MANUAL_LINE_TYPES.map((option) => (
                <Select.Item key={option.value} value={option.value}>
                  {option.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <input type="hidden" name="line_type" value={lineType} />
        </Box>
        <Box style={{ flex: "1 1 220px" }}>
          <Text as="label" size="1" color="gray" htmlFor="add-line-description">
            Description
          </Text>
          <TextField.Root
            id="add-line-description"
            name="description"
            placeholder="Description"
            defaultValue={submitted?.description !== undefined ? String(submitted.description) : ""}
            size="2"
          />
        </Box>
        <Box style={{ width: "90px" }}>
          <Text as="label" size="1" color="gray" htmlFor="add-line-quantity">
            Qty
          </Text>
          <TextField.Root
            id="add-line-quantity"
            name="quantity"
            placeholder="Qty"
            defaultValue={submitted?.quantity !== undefined ? String(submitted.quantity) : "1"}
            size="2"
          />
        </Box>
        <Box style={{ width: "120px" }}>
          <Text as="label" size="1" color="gray" htmlFor="add-line-unit-amount">
            Unit (USD)
          </Text>
          <TextField.Root
            id="add-line-unit-amount"
            name="unit_amount"
            placeholder="Unit (USD)"
            defaultValue={submitted?.unit_amount !== undefined ? String(submitted.unit_amount) : ""}
            size="2"
          />
        </Box>
        <Flex align="center" gap="2" asChild>
          <label>
            <Checkbox name="taxable" defaultChecked={taxableChecked} />
            <Text size="1">Taxable</Text>
          </label>
        </Flex>
        <Button type="submit" size="2" disabled={pending}>
          {pending ? "Adding…" : "Add line"}
        </Button>
        {state.error ? (
          <Text size="1" color="red" style={{ width: "100%" }} role="alert">
            {state.error}
          </Text>
        ) : null}
      </Flex>
    </form>
  );
}

function RebillRow({
  invoiceId,
  expense,
}: {
  invoiceId: string;
  expense: RebillableExpense;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  return (
    <Flex align="center" gap="4">
      <Text color="gray" style={{ flex: 1 }}>
        {categoryLabel(expense.category)} {expense.vendor ? `— ${expense.vendor}` : ""} (
        {formatDate(expense.incurred_on)}) ·{" "}
        <span className="tnum">{formatCents(expense.amount_cents)}</span>
      </Text>
      <Button
        variant="outline"
        size="2"
        disabled={pending || added}
        aria-label={`Add to invoice — ${categoryLabel(expense.category)}${
          expense.vendor ? ` — ${expense.vendor}` : ""
        } (${formatDate(expense.incurred_on)})`}
        onClick={() => {
          startTransition(async () => {
            const result = await addRebillExpenseLine(invoiceId, expense.id);
            if (result?.error) setError(result.error);
            else setAdded(true);
          });
        }}
      >
        {added ? "Added" : pending ? "Adding…" : "Add to invoice"}
      </Button>
      {error ? (
        <Text size="1" color="red" role="alert">
          {error}
        </Text>
      ) : null}
    </Flex>
  );
}
