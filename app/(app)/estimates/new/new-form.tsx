"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import {
  Box,
  Button,
  Card,
  Checkbox,
  Flex,
  Grid,
  Select,
  Text,
  TextArea,
  TextField,
} from "@/components/ui";
import { formatCents, parseDollarsToCents } from "@/lib/format";
import type { EstimateFormState } from "../actions";
import {
  ESTIMATE_LINE_TYPES,
  ESTIMATE_LINE_TYPE_LABEL,
  parsePercentToBps,
  parseQuantity,
  previewTotals,
} from "../estimate-lib";

export type ClientOption = { id: string; name: string };

/**
 * One typed-in quote line. Held in React state (controlled inputs), which
 * is what makes this form survive React 19's post-action form reset on the
 * error path without the `values` echo the uncontrolled forms need — a
 * controlled input re-renders from state, and state outlives the dispatch.
 * Same reason draft-form.tsx keeps its tax rate controlled.
 */
type LineDraft = {
  key: number;
  line_type: string;
  description: string;
  quantity: string;
  unit_amount: string;
  taxable: boolean;
};

const emptyLine = (key: number): LineDraft => ({
  key,
  line_type: "flight_day",
  description: "",
  quantity: "1",
  unit_amount: "",
  taxable: true,
});

const initialState: EstimateFormState = { error: null };

export default function NewEstimateForm({
  action,
  clients,
}: {
  action: (state: EstimateFormState, formData: FormData) => Promise<EstimateFormState>;
  clients: ClientOption[];
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [clientId, setClientId] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [terms, setTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(0)]);
  const [nextKey, setNextKey] = useState(1);

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine(nextKey)]);
    setNextKey((k) => k + 1);
  }

  function removeLine(key: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((line) => line.key !== key) : prev));
  }

  // Running preview, computed with the SAME per-line rounding and
  // taxable-only tax base pilot.estimate_totals uses (previewTotals's own
  // comment) — so the figure here is the figure the draft will show. Rows
  // that don't parse yet simply don't count toward it.
  const parsedForPreview = lines.flatMap((line) => {
    const quantity = parseQuantity(line.quantity);
    const unitAmountCents = parseDollarsToCents(line.unit_amount);
    if (
      quantity === undefined ||
      unitAmountCents === undefined ||
      unitAmountCents === null ||
      unitAmountCents < 0
    ) {
      return [];
    }
    return [{ quantity, unitAmountCents, taxable: line.taxable }];
  });
  const previewBps = parsePercentToBps(taxRate);
  const preview = previewTotals(parsedForPreview, previewBps ?? 0);

  return (
    <Card size="3">
      <form action={formAction}>
        <input type="hidden" name="client_id" value={clientId} />

        <Grid columns={{ initial: "1", md: "3" }} gap="4">
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" id="estimate-client-label">
              Client
            </Text>
            <Select.Root value={clientId || undefined} onValueChange={setClientId}>
              <Select.Trigger
                aria-labelledby="estimate-client-label"
                placeholder="Choose a client"
              />
              <Select.Content>
                {clients.map((client) => (
                  <Select.Item key={client.id} value={client.id}>
                    {client.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <Text size="1" color="gray">
              {clients.length === 0
                ? "No active clients yet — add one before drafting an estimate."
                : "Who this quote is for"}
            </Text>
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="valid_until">
              Valid until
            </Text>
            <TextField.Root
              id="valid_until"
              type="date"
              name="valid_until"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
            <Text size="1" color="gray">
              How long the quoted price stands — optional, but a quote with no
              expiry is a price you&rsquo;re holding open indefinitely
            </Text>
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="tax_rate_percent">
              Tax rate (%)
            </Text>
            <TextField.Root
              id="tax_rate_percent"
              name="tax_rate_percent"
              inputMode="decimal"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
            />
            <Text size="1" color="gray">
              State sales/service tax, if any — applied to taxable lines only
            </Text>
          </Flex>
        </Grid>

        <Flex direction="column" gap="3" mt="6">
          <Text size="4" weight="bold">
            Line items
          </Text>
          {lines.map((line, index) => (
            <LineRow
              key={line.key}
              line={line}
              index={index}
              removable={lines.length > 1}
              onChange={(patch) => updateLine(line.key, patch)}
              onRemove={() => removeLine(line.key)}
            />
          ))}
          <Flex>
            <Button type="button" variant="soft" size="2" onClick={addLine}>
              Add another line
            </Button>
          </Flex>
          {parsedForPreview.length > 0 ? (
            <Flex direction="column" gap="1" align="end">
              <PreviewLine label="Subtotal" value={preview.subtotalCents} />
              <PreviewLine label="Tax" value={preview.taxCents} />
              <PreviewLine label="Total" value={preview.totalCents} emphasize />
            </Flex>
          ) : null}
        </Flex>

        <Grid columns={{ initial: "1", md: "2" }} gap="4" mt="6">
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="terms">
              Terms
            </Text>
            <TextArea
              id="terms"
              name="terms"
              rows={3}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="Cancellation terms, per-diem basis, what's not included…"
            />
            <Text size="1" color="gray">
              What the client is being told beyond the line items
            </Text>
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="notes">
              Notes
            </Text>
            <TextArea
              id="notes"
              name="notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <Text size="1" color="gray">
              Carried onto the invoice if this estimate converts
            </Text>
          </Flex>
        </Grid>

        <Text as="div" size="1" color="gray" mt="4">
          An estimate is a quote, not an invoice — no payment can be recorded
          against it, and nothing goes to the client until you send it. It gets
          its permanent number when sent.
        </Text>

        <Flex mt="3" role="alert" aria-live="polite">
          {state.error ? (
            <Text size="1" color="red">
              {state.error}
            </Text>
          ) : null}
        </Flex>

        <Flex mt="4" gap="3">
          <Button type="submit" disabled={pending || !clientId}>
            {pending ? "Drafting…" : "Draft estimate"}
          </Button>
          <Button asChild variant="outline">
            <NextLink href="/estimates">Cancel</NextLink>
          </Button>
        </Flex>
      </form>
    </Card>
  );
}

/**
 * Each field posts on every row — the selects and checkboxes through
 * hidden inputs — so the server's parallel `getAll` arrays can never
 * misalign (an unchecked native checkbox posts nothing, which is exactly
 * the misalignment the hidden input exists to prevent).
 */
function LineRow({
  line,
  index,
  removable,
  onChange,
  onRemove,
}: {
  line: LineDraft;
  index: number;
  removable: boolean;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <Flex gap="3" align="start" wrap="wrap">
      <Box style={{ width: "170px" }}>
        <Text as="label" size="1" color="gray" id={`line-type-label-${line.key}`}>
          Type
        </Text>
        <Select.Root
          value={line.line_type}
          onValueChange={(value) => onChange({ line_type: value })}
        >
          <Select.Trigger aria-labelledby={`line-type-label-${line.key}`} />
          <Select.Content>
            {ESTIMATE_LINE_TYPES.map((value) => (
              <Select.Item key={value} value={value}>
                {ESTIMATE_LINE_TYPE_LABEL[value]}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <input type="hidden" name="line_type" value={line.line_type} />
      </Box>
      <Box style={{ flex: "1 1 220px" }}>
        <Text as="label" size="1" color="gray" htmlFor={`line-description-${line.key}`}>
          Description
        </Text>
        <TextField.Root
          id={`line-description-${line.key}`}
          name="line_description"
          placeholder={index === 0 ? "e.g. Flight day — CE-560XL" : "Description"}
          value={line.description}
          onChange={(e) => onChange({ description: e.target.value })}
          size="2"
        />
      </Box>
      <Box style={{ width: "90px" }}>
        <Text as="label" size="1" color="gray" htmlFor={`line-quantity-${line.key}`}>
          Qty
        </Text>
        <TextField.Root
          id={`line-quantity-${line.key}`}
          name="line_quantity"
          value={line.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
          size="2"
        />
      </Box>
      <Box style={{ width: "120px" }}>
        <Text as="label" size="1" color="gray" htmlFor={`line-unit-${line.key}`}>
          Unit (USD)
        </Text>
        <TextField.Root
          id={`line-unit-${line.key}`}
          name="line_unit_amount"
          placeholder="1500.00"
          value={line.unit_amount}
          onChange={(e) => onChange({ unit_amount: e.target.value })}
          size="2"
        />
      </Box>
      <Flex align="center" gap="2" mt="4" asChild>
        <label>
          <input type="hidden" name="line_taxable" value={line.taxable ? "on" : "off"} />
          <Checkbox
            checked={line.taxable}
            onCheckedChange={(checked) => onChange({ taxable: checked === true })}
          />
          <Text size="1">Taxable</Text>
        </label>
      </Flex>
      {removable ? (
        <Flex mt="4">
          <Button
            type="button"
            variant="ghost"
            color="red"
            size="1"
            aria-label={`Remove line ${index + 1}`}
            onClick={onRemove}
          >
            Remove
          </Button>
        </Flex>
      ) : null}
    </Flex>
  );
}

function PreviewLine({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <Flex gap="4" minWidth="220px" justify="between">
      <Text size="2" color="gray" weight={emphasize ? "bold" : "regular"}>
        {label}
      </Text>
      <Text size="2" weight={emphasize ? "bold" : "regular"} className="tnum">
        {formatCents(value)}
      </Text>
    </Flex>
  );
}
