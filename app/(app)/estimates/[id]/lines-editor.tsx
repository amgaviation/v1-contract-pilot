"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { LButton, LTable, LTd, LTh } from "@/components/ledger";
import { LConfirmDialog } from "@/components/ledger/dialog";
import { LCheckbox, LInput, LSelect } from "@/components/ledger/forms";
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
    return <p className="text-ink-2">No line items.</p>;
  }

  return (
    <div>
      <LTable>
        <caption>
          <span className="sr-only">Estimate lines</span>
        </caption>
        <thead>
          <tr>
            <LTh>Type</LTh>
            <LTh>Description</LTh>
            <LTh numeric>Qty</LTh>
            <LTh numeric>Unit</LTh>
            <LTh numeric>Amount</LTh>
            <LTh>Taxable</LTh>
            <LTh>
              <span className="sr-only">Actions</span>
            </LTh>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) =>
            editable ? (
              <EditableRow key={line.id} estimateId={estimateId} line={line} />
            ) : (
              <ReadOnlyRow key={line.id} line={line} />
            )
          )}
        </tbody>
      </LTable>

      {editable ? (
        <div className="mt-5">
          <p className="font-bold text-ink">Add a line</p>
          <AddLineForm estimateId={estimateId} />
        </div>
      ) : null}
    </div>
  );
}

function ReadOnlyRow({ line }: { line: EstimateLineRow }) {
  return (
    <tr>
      <LTd>
        <span className="text-ink-2">{ESTIMATE_LINE_TYPE_LABEL[line.line_type]}</span>
      </LTd>
      <LTd>{line.description}</LTd>
      <LTd numeric>{line.quantity}</LTd>
      <LTd numeric>{formatCents(line.unit_amount_cents)}</LTd>
      <LTd numeric>
        <span className="font-medium">{formatCents(line.amount_cents)}</span>
      </LTd>
      <LTd>
        <span className="text-ink-2">{line.taxable ? "Yes" : "No"}</span>
      </LTd>
      <LTd />
    </tr>
  );
}

function EditableRow({ estimateId, line }: { estimateId: string; line: EstimateLineRow }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateEstimateLine, initialLineState);
  const [deletePending, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

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
  // Controlled + hidden input, not a native defaultChecked: the native
  // form "reset" React 19 fires after every dispatch would otherwise
  // restore the FIRST-MOUNT checked value — see the invoice lines editor's
  // comment for the full mechanism (ported unchanged; only the checkbox's
  // skin changed from Radix to LCheckbox).
  const [taxable, setTaxable] = useState(taxableChecked);
  useEffect(() => {
    setTaxable(taxableChecked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  if (!editing) {
    return (
      <tr>
        <LTd>
          <span className="text-ink-2">{ESTIMATE_LINE_TYPE_LABEL[line.line_type]}</span>
        </LTd>
        <LTd>{line.description}</LTd>
        <LTd numeric>{line.quantity}</LTd>
        <LTd numeric>{formatCents(line.unit_amount_cents)}</LTd>
        <LTd numeric>
          <span className="font-medium">{formatCents(line.amount_cents)}</span>
        </LTd>
        <LTd>
          <span className="text-ink-2">{line.taxable ? "Yes" : "No"}</span>
        </LTd>
        <LTd>
          <div className="flex justify-end gap-3">
            <LButton
              type="button"
              variant="quiet"
              size="sm"
              aria-label={`Edit: ${line.description}`}
              onClick={() => setEditing(true)}
            >
              Edit
            </LButton>
            <LButton
              type="button"
              variant="outline"
              size="sm"
              className="border-crit text-crit hover:bg-crit-soft"
              disabled={deletePending}
              aria-label={`Remove: ${line.description}`}
              onClick={() => setConfirmOpen(true)}
            >
              {deletePending ? "Removing…" : "Remove"}
            </LButton>
            <LConfirmDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              title="Remove this line?"
              description="This removes the line from the estimate. This can't be undone."
              confirmLabel="Remove"
              confirmVariant="danger"
              onConfirm={() => {
                setConfirmOpen(false);
                startDelete(async () => {
                  const result = await deleteEstimateLine(line.id, estimateId);
                  setDeleteError(result?.error ?? null);
                });
              }}
            />
          </div>
          {deleteError ? (
            <p className="mt-1 text-caption text-crit" role="alert">
              {deleteError}
            </p>
          ) : null}
        </LTd>
      </tr>
    );
  }

  return (
    <tr>
      <LTd colSpan={7}>
        <form action={formAction}>
          <div className="flex flex-wrap items-start gap-3">
            <input type="hidden" name="id" value={line.id} />
            <input type="hidden" name="estimate_id" value={estimateId} />
            <div className="min-w-56 flex-1">
              <label htmlFor={`description-${line.id}`} className="text-caption text-ink-3">
                Description
              </label>
              <LInput
                id={`description-${line.id}`}
                name="description"
                placeholder="Description"
                defaultValue={echoed("description", line.description)}
              />
            </div>
            <div className="w-24">
              <label htmlFor={`quantity-${line.id}`} className="text-caption text-ink-3">
                Qty
              </label>
              <LInput
                id={`quantity-${line.id}`}
                name="quantity"
                placeholder="Qty"
                defaultValue={echoed("quantity", String(line.quantity))}
              />
            </div>
            <div className="w-28">
              <label htmlFor={`unit_amount-${line.id}`} className="text-caption text-ink-3">
                Unit (USD)
              </label>
              <LInput
                id={`unit_amount-${line.id}`}
                name="unit_amount"
                placeholder="Unit (USD)"
                defaultValue={echoed("unit_amount", centsToInput(line.unit_amount_cents))}
              />
            </div>
            <label className="mt-6 flex items-center gap-2">
              <input type="hidden" name="taxable" value={taxable ? "on" : "off"} />
              <LCheckbox checked={taxable} onChange={(e) => setTaxable(e.target.checked)} />
              <span className="text-caption text-ink">Taxable</span>
            </label>
            <div className="mt-6 flex gap-2">
              {/* Outline, not filled — the detail page's one accent action
                  is StatusActions' live CTA. */}
              <LButton type="submit" variant="outline" size="sm" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </LButton>
              <LButton
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditing(false)}
              >
                Cancel
              </LButton>
            </div>
            {state.error ? (
              <p className="w-full text-caption text-crit" role="alert">
                {state.error}
              </p>
            ) : null}
          </div>
        </form>
      </LTd>
    </tr>
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
  // Controlled + a hidden input carries the posted value, same as every
  // other Select in this product — see EditableRow's comment.
  const [lineType, setLineType] = useState(() =>
    submitted?.line_type !== undefined ? String(submitted.line_type) : "flight_day"
  );
  useEffect(() => {
    if (submitted?.line_type !== undefined) setLineType(String(submitted.line_type));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  return (
    <form action={formAction}>
      <div className="mt-2 flex flex-wrap items-start gap-3">
        <input type="hidden" name="estimate_id" value={estimateId} />
        <div className="w-44">
          <label id="add-line-type-label" className="text-caption text-ink-3">
            Type
          </label>
          <LSelect
            aria-labelledby="add-line-type-label"
            value={lineType}
            onChange={(e) => setLineType(e.target.value)}
          >
            {ESTIMATE_LINE_TYPES.map((value) => (
              <option key={value} value={value}>
                {ESTIMATE_LINE_TYPE_LABEL[value]}
              </option>
            ))}
          </LSelect>
          <input type="hidden" name="line_type" value={lineType} />
        </div>
        <div className="min-w-56 flex-1">
          <label htmlFor="add-line-description" className="text-caption text-ink-3">
            Description
          </label>
          <LInput
            id="add-line-description"
            name="description"
            placeholder="Description"
            defaultValue={submitted?.description !== undefined ? String(submitted.description) : ""}
          />
        </div>
        <div className="w-24">
          <label htmlFor="add-line-quantity" className="text-caption text-ink-3">
            Qty
          </label>
          <LInput
            id="add-line-quantity"
            name="quantity"
            placeholder="Qty"
            defaultValue={submitted?.quantity !== undefined ? String(submitted.quantity) : "1"}
          />
        </div>
        <div className="w-28">
          <label htmlFor="add-line-unit-amount" className="text-caption text-ink-3">
            Unit (USD)
          </label>
          <LInput
            id="add-line-unit-amount"
            name="unit_amount"
            placeholder="1500.00"
            defaultValue={submitted?.unit_amount !== undefined ? String(submitted.unit_amount) : ""}
          />
        </div>
        <label className="mt-6 flex items-center gap-2">
          <input type="hidden" name="taxable" value={taxable ? "on" : "off"} />
          <LCheckbox checked={taxable} onChange={(e) => setTaxable(e.target.checked)} />
          <span className="text-caption text-ink">Taxable</span>
        </label>
        {/* Outline, not filled — see the header comment on EditableRow's
            Save button for why. */}
        <LButton type="submit" variant="outline" size="sm" disabled={pending} className="mt-6">
          {pending ? "Adding…" : "Add line"}
        </LButton>
        {state.error ? (
          <p className="w-full text-caption text-crit" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
