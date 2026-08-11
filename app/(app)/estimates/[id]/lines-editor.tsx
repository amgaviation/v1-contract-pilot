"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  AlertDialog,
  Box,
  Button,
  Checkbox,
  Flex,
  Select,
  Table,
  Text,
  TextField,
} from "@/components/ui";
import { formatCents, centsToInput } from "@/lib/format";
import {
  addEstimateLine,
  deleteEstimateLine,
  updateEstimateLine,
  type EstimateLineFormState,
  type EstimateLineFormValues,
} from "../actions";
import {
  ESTIMATE_LINE_TYPES,
  ESTIMATE_LINE_TYPE_LABEL,
  type EstimateLineType,
} from "../estimate-lib";

export type EstimateLineRow = {
  id: string;
  estimate_id: string;
  line_type: EstimateLineType;
  description: string;
  quantity: number;
  unit_amount_cents: number;
  amount_cents: number;
  taxable: boolean;
};

const initialLineState: EstimateLineFormState = { error: null };

export default function LinesEditor({
  estimateId,
  lines,
  editable,
}: {
  estimateId: string;
  lines: EstimateLineRow[];
  editable: boolean;
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
              <EditableRow key={line.id} estimateId={estimateId} line={line} />
            ) : (
              <ReadOnlyRow key={line.id} line={line} />
            )
          )}
        </Table.Body>
      </Table.Root>

      {editable ? (
        <Box mt="5">
          <Text weight="bold">Add a line</Text>
          <AddLineForm estimateId={estimateId} />
        </Box>
      ) : null}
    </Box>
  );
}

function ReadOnlyRow({ line }: { line: EstimateLineRow }) {
  return (
    <Table.Row>
      <Table.Cell>
        <Text color="gray">{ESTIMATE_LINE_TYPE_LABEL[line.line_type]}</Text>
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

function EditableRow({ estimateId, line }: { estimateId: string; line: EstimateLineRow }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateEstimateLine, initialLineState);
  const [deletePending, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // A rejected submit must show and re-post what the pilot typed, not the
  // line's stored (pre-edit) values — React 19 resets an uncontrolled form
  // on every action dispatch, error path included, so the values are
  // re-seeded from the action's echo and fall back to the stored line only
  // on first render. Same pattern (and same taxable-checkbox
  // disambiguation) as the invoice lines editor.
  const submitted = state.values;
  const echoed = (key: keyof EstimateLineFormValues, fallback: string) =>
    submitted?.[key] ?? fallback;
  // `submitted` present but with no "taxable" key means "submitted, box
  // was unchecked" — not "no submission yet". The two must not collapse to
  // the same fallback or an unchecked box silently re-checks itself on the
  // error render.
  const taxableChecked = submitted ? submitted.taxable === "on" : line.taxable;
  // Controlled + hidden input, not defaultChecked: Radix's Checkbox
  // restores its FIRST-MOUNT checked value on the native form "reset"
  // React 19 fires after every dispatch — see the invoice lines editor's
  // comment for the full mechanism.
  const [taxable, setTaxable] = useState(taxableChecked);
  useEffect(() => {
    setTaxable(taxableChecked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  if (!editing) {
    return (
      <Table.Row>
        <Table.Cell>
          <Text color="gray">{ESTIMATE_LINE_TYPE_LABEL[line.line_type]}</Text>
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
                  This removes the line from the estimate. This can&rsquo;t be undone.
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
                          const result = await deleteEstimateLine(line.id, estimateId);
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

  return (
    <Table.Row>
      <Table.Cell colSpan={7}>
        <form action={formAction}>
          <Flex gap="3" align="start" wrap="wrap">
            <input type="hidden" name="id" value={line.id} />
            <input type="hidden" name="estimate_id" value={estimateId} />
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
                <input type="hidden" name="taxable" value={taxable ? "on" : "off"} />
                <Checkbox
                  checked={taxable}
                  onCheckedChange={(checked) => setTaxable(checked === true)}
                />
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

function AddLineForm({ estimateId }: { estimateId: string }) {
  const [state, formAction, pending] = useActionState(addEstimateLine, initialLineState);
  // Same echo as EditableRow: the action returns what was submitted so a
  // rejected add re-renders the pilot's entry rather than an empty form.
  const submitted = state.values;
  const taxableChecked = submitted ? submitted.taxable === "on" : true;
  const [taxable, setTaxable] = useState(taxableChecked);
  useEffect(() => {
    setTaxable(taxableChecked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);
  // Same Select.Root uncontrolled-bubble-input issue as elsewhere: `name`
  // dropped, real value posted from a controlled hidden input so a
  // rejected add doesn't silently revert the line type.
  const [lineType, setLineType] = useState(() =>
    submitted?.line_type !== undefined ? String(submitted.line_type) : "flight_day"
  );
  useEffect(() => {
    if (submitted?.line_type !== undefined) setLineType(String(submitted.line_type));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  return (
    <form action={formAction}>
      <Flex mt="2" gap="3" align="start" wrap="wrap">
        <input type="hidden" name="estimate_id" value={estimateId} />
        <Box style={{ width: "170px" }}>
          <Text as="label" size="1" color="gray" id="add-line-type-label">
            Type
          </Text>
          <Select.Root value={lineType} onValueChange={setLineType}>
            <Select.Trigger aria-labelledby="add-line-type-label" />
            <Select.Content>
              {ESTIMATE_LINE_TYPES.map((value) => (
                <Select.Item key={value} value={value}>
                  {ESTIMATE_LINE_TYPE_LABEL[value]}
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
            placeholder="1500.00"
            defaultValue={submitted?.unit_amount !== undefined ? String(submitted.unit_amount) : ""}
            size="2"
          />
        </Box>
        <Flex align="center" gap="2" asChild>
          <label>
            <input type="hidden" name="taxable" value={taxable ? "on" : "off"} />
            <Checkbox
              checked={taxable}
              onCheckedChange={(checked) => setTaxable(checked === true)}
            />
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
