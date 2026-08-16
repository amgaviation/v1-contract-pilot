"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import { LButton, LCard, lButtonClass } from "@/components/ledger";
import { LCheckbox, LField, LInput, LSelect, LTextarea } from "@/components/ledger/forms";
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
    <LCard>
      <form action={formAction}>
        <input type="hidden" name="client_id" value={clientId} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label id="estimate-client-label" className="text-body-s font-medium text-ink">
              Client
            </label>
            <LSelect
              aria-labelledby="estimate-client-label"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="" disabled>
                Choose a client
              </option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </LSelect>
            <p className="text-caption text-ink-3">
              {clients.length === 0
                ? "No active clients yet. Add one before you can draft an estimate."
                : "Who this quote is for"}
            </p>
          </div>
          <LField
            label="Valid until"
            htmlFor="valid_until"
            hint="How long the quoted price stands. Optional, but a quote with no expiry holds the price open indefinitely"
          >
            <LInput
              id="valid_until"
              type="date"
              name="valid_until"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </LField>
          <LField
            label="Tax rate (%)"
            htmlFor="tax_rate_percent"
            hint="State sales or service tax, if any. Applies to taxable lines only"
          >
            <LInput
              id="tax_rate_percent"
              name="tax_rate_percent"
              inputMode="decimal"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
            />
          </LField>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <p className="text-lead font-bold text-ink">Line items</p>
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
          <div>
            <LButton type="button" variant="outline" size="sm" onClick={addLine}>
              Add another line
            </LButton>
          </div>
          {parsedForPreview.length > 0 ? (
            <div className="flex flex-col items-end gap-1">
              <PreviewLine label="Subtotal" value={preview.subtotalCents} />
              <PreviewLine label="Tax" value={preview.taxCents} />
              <PreviewLine label="Total" value={preview.totalCents} emphasize />
            </div>
          ) : null}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <LField
            label="Terms"
            htmlFor="terms"
            hint="What the client is being told beyond the line items"
          >
            <LTextarea
              id="terms"
              name="terms"
              rows={3}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="Cancellation terms, per-diem basis, what's not included…"
            />
          </LField>
          <LField
            label="Notes"
            htmlFor="notes"
            hint="Carried onto the invoice if this estimate converts"
          >
            <LTextarea
              id="notes"
              name="notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </LField>
        </div>

        <p className="mt-4 text-caption text-ink-3">
          An estimate is a quote, not an invoice. No payment can be recorded
          against it, and nothing goes to the client until you send it. It gets
          its permanent number when sent.
        </p>

        <div role="alert" aria-live="polite" className="mt-3">
          {state.error ? <p className="text-caption font-medium text-crit">{state.error}</p> : null}
        </div>

        <div className="mt-4 flex gap-3">
          {/* THE ONE FILLED ACCENT BUTTON on this screen. */}
          <LButton type="submit" disabled={pending || !clientId}>
            {pending ? "Drafting…" : "Draft estimate"}
          </LButton>
          <NextLink href="/estimates" className={lButtonClass({ variant: "outline" })}>
            Cancel
          </NextLink>
        </div>
      </form>
    </LCard>
  );
}

/**
 * Each field posts on every row — the selects and checkboxes through
 * hidden inputs — so the server's parallel `getAll` arrays can never
 * misalign (an unchecked native checkbox posts nothing, which is exactly
 * the misalignment the hidden input exists to prevent). Kept unchanged by
 * the Ledger port even though LSelect is a real `<select>` that would post
 * its own value: the hidden input stays the single posting mechanism for
 * every row field so the server-visible form data is provably identical to
 * before, not merely equivalent.
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
    <div className="flex flex-wrap items-start gap-3">
      <div className="w-44">
        <label id={`line-type-label-${line.key}`} className="text-caption text-ink-3">
          Type
        </label>
        <LSelect
          aria-labelledby={`line-type-label-${line.key}`}
          value={line.line_type}
          onChange={(e) => onChange({ line_type: e.target.value })}
        >
          {ESTIMATE_LINE_TYPES.map((value) => (
            <option key={value} value={value}>
              {ESTIMATE_LINE_TYPE_LABEL[value]}
            </option>
          ))}
        </LSelect>
        <input type="hidden" name="line_type" value={line.line_type} />
      </div>
      <div className="min-w-56 flex-1">
        <label htmlFor={`line-description-${line.key}`} className="text-caption text-ink-3">
          Description
        </label>
        <LInput
          id={`line-description-${line.key}`}
          name="line_description"
          placeholder={index === 0 ? "e.g. Flight day, CE-560XL" : "Description"}
          value={line.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>
      <div className="w-24">
        <label htmlFor={`line-quantity-${line.key}`} className="text-caption text-ink-3">
          Qty
        </label>
        <LInput
          id={`line-quantity-${line.key}`}
          name="line_quantity"
          value={line.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
        />
      </div>
      <div className="w-28">
        <label htmlFor={`line-unit-${line.key}`} className="text-caption text-ink-3">
          Unit (USD)
        </label>
        <LInput
          id={`line-unit-${line.key}`}
          name="line_unit_amount"
          placeholder="1500.00"
          value={line.unit_amount}
          onChange={(e) => onChange({ unit_amount: e.target.value })}
        />
      </div>
      <label className="mt-6 flex items-center gap-2">
        <input type="hidden" name="line_taxable" value={line.taxable ? "on" : "off"} />
        <LCheckbox
          checked={line.taxable}
          onChange={(e) => onChange({ taxable: e.target.checked })}
        />
        <span className="text-caption text-ink">Taxable</span>
      </label>
      {removable ? (
        <button
          type="button"
          aria-label={`Remove line ${index + 1}`}
          onClick={onRemove}
          className="mt-6 text-caption font-medium text-crit hover:underline"
        >
          Remove
        </button>
      ) : null}
    </div>
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
    <div className="flex min-w-56 justify-between gap-4">
      <span className={emphasize ? "text-body-s font-bold text-ink-2" : "text-body-s text-ink-2"}>
        {label}
      </span>
      <span className={emphasize ? "tnum-l text-body-s font-bold" : "tnum-l text-body-s"}>
        {formatCents(value)}
      </span>
    </div>
  );
}
