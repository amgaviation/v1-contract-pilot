"use client";

import NextLink from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { LButton, LTable, LTd, LTh } from "@/components/ledger";
import { LConfirmDialog } from "@/components/ledger/dialog";
import { LCheckbox, LField, LInput, LSelect } from "@/components/ledger/forms";
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
  categoryLabels,
}: {
  invoiceId: string;
  lines: LineRow[];
  editable: boolean;
  rebillable: RebillableExpense[];
  /**
   * The tenant's own expense-category vocabulary (lib/custom-options.ts),
   * resolved server-side via loadOptionLabels("expense_category") — the
   * same source createInvoiceDraft/addRebillExpenseLine now write onto the
   * line itself. Falls back to labels.ts's static map for any key it
   * doesn't cover, same as those server actions do.
   */
  categoryLabels: Record<string, string>;
}) {
  if (lines.length === 0 && !editable) {
    return <p className="text-ink-3">No line items.</p>;
  }

  return (
    <div>
      <LTable>
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
              <EditableRow key={line.id} invoiceId={invoiceId} line={line} />
            ) : (
              <ReadOnlyRow key={line.id} line={line} />
            )
          )}
        </tbody>
      </LTable>

      {editable ? (
        <>
          {rebillable.length > 0 ? (
            <div className="mt-5">
              <p className="font-bold">Rebillable expenses</p>
              <div className="mt-2 flex flex-col gap-2">
                {rebillable.map((expense) => (
                  <RebillRow
                    key={expense.id}
                    invoiceId={invoiceId}
                    expense={expense}
                    categoryLabels={categoryLabels}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-5">
            <p className="font-bold">Add a line</p>
            <AddLineForm invoiceId={invoiceId} />
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * THE RECORD A LINE BILLS, reachable from the line. Reviewing a draft
 * before sending it ("is that really three billable days, and which
 * dates?") otherwise means leaving the invoice, finding the trip by date
 * in the Trips list, and coming back. Both ids are already on the row —
 * invoices/[id]/page.tsx selects them — so this is a link, not a read.
 */
function LineSourceLink({ line }: { line: LineRow }) {
  const target = line.trip_id
    ? { href: `/trips/${line.trip_id}`, label: "View trip" }
    : line.expense_id
      ? { href: `/expenses/${line.expense_id}`, label: "View expense" }
      : null;
  if (!target) return null;
  return (
    <NextLink
      href={target.href}
      className="ml-2 whitespace-nowrap text-caption text-accent hover:underline"
    >
      {target.label}
    </NextLink>
  );
}

function ReadOnlyRow({ line }: { line: LineRow }) {
  return (
    <tr>
      <LTd>
        <span className="text-ink-3">{LINE_TYPE_LABEL[line.line_type]}</span>
      </LTd>
      <LTd>
        {line.description}
        <LineSourceLink line={line} />
      </LTd>
      <LTd numeric>{line.quantity}</LTd>
      <LTd numeric>{formatCents(line.unit_amount_cents)}</LTd>
      <LTd numeric>
        <span className="font-medium">{formatCents(line.amount_cents)}</span>
      </LTd>
      <LTd>
        <span className="text-ink-3">{line.taxable ? "Yes" : "No"}</span>
      </LTd>
      <LTd />
    </tr>
  );
}

function EditableRow({ invoiceId, line }: { invoiceId: string; line: LineRow }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateInvoiceLine, initialLineState);
  const [deletePending, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const removeDialog = (
    <LConfirmDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title="Remove this line?"
      description="This removes the line from the invoice. This can’t be undone."
      confirmLabel="Remove"
      confirmVariant="danger"
      pending={deletePending}
      onConfirm={() => {
        // Closes the instant it's pressed, exactly as Radix's
        // AlertDialog.Action always did — not gated on the async result.
        // deleteError renders below the Remove button, after the dialog
        // is already gone.
        setConfirmOpen(false);
        startDelete(async () => {
          const result = await deleteInvoiceLine(line.id, invoiceId);
          setDeleteError(result?.error ?? null);
        });
      }}
    />
  );

  if (!editing) {
    return (
      <tr>
        <LTd>
          <span className="text-ink-3">{LINE_TYPE_LABEL[line.line_type]}</span>
        </LTd>
        <LTd>
          {line.description}
          <LineSourceLink line={line} />
        </LTd>
        <LTd numeric>{line.quantity}</LTd>
        <LTd numeric>{formatCents(line.unit_amount_cents)}</LTd>
        <LTd numeric>
          <span className="font-medium">{formatCents(line.amount_cents)}</span>
        </LTd>
        <LTd>
          <span className="text-ink-3">{line.taxable ? "Yes" : "No"}</span>
        </LTd>
        <LTd className="text-right">
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
              variant="quiet"
              size="sm"
              className="text-crit hover:text-crit"
              disabled={deletePending}
              aria-label={`Remove: ${line.description}`}
              onClick={() => setConfirmOpen(true)}
            >
              {deletePending ? "Removing…" : "Remove"}
            </LButton>
            {removeDialog}
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
  // `defaultChecked` cannot deliver a resubmit-safe echo here: the native
  // `<form>` "reset" event React 19 fires after every action dispatch —
  // including a rejected one — restores a checkbox to whatever its
  // `checked` attribute was at mount, not to this component's live state,
  // and a re-render doesn't correct it until the checked PROP actually
  // changes. A pilot who unticks Taxable, then trips validation on another
  // field, would watch this box silently re-check itself on the error
  // render. Making the box CONTROLLED (checked + onChange) sidesteps that
  // by re-syncing the checked property from state on every render, and a
  // hidden input posts the real value since a controlled checkbox doesn't
  // reliably participate in native form submission on its own. Same
  // pattern as trips/day-grid.tsx's `away` flag.
  const [taxable, setTaxable] = useState(taxableChecked);
  useEffect(() => {
    setTaxable(taxableChecked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  return (
    <tr>
      <LTd colSpan={7}>
        <form action={formAction}>
          <div className="flex flex-wrap items-start gap-3">
            <input type="hidden" name="id" value={line.id} />
            <input type="hidden" name="invoice_id" value={invoiceId} />
            <div className="flex-1 basis-56">
              <LField label="Description" htmlFor={`description-${line.id}`}>
                <LInput
                  id={`description-${line.id}`}
                  name="description"
                  placeholder="Description"
                  defaultValue={echoed("description", line.description)}
                />
              </LField>
            </div>
            <div className="w-20">
              <LField label="Qty" htmlFor={`quantity-${line.id}`}>
                <LInput
                  id={`quantity-${line.id}`}
                  name="quantity"
                  placeholder="Qty"
                  defaultValue={echoed("quantity", String(line.quantity))}
                />
              </LField>
            </div>
            <div className="w-28">
              <LField label="Unit (USD)" htmlFor={`unit_amount-${line.id}`}>
                <LInput
                  id={`unit_amount-${line.id}`}
                  name="unit_amount"
                  placeholder="Unit (USD)"
                  defaultValue={echoed("unit_amount", centsToInput(line.unit_amount_cents))}
                />
              </LField>
            </div>
            <label className="flex items-center gap-2 self-center pt-5">
              <input type="hidden" name="taxable" value={taxable ? "on" : "off"} />
              <LCheckbox
                checked={taxable}
                onChange={(e) => setTaxable(e.target.checked)}
              />
              <span className="text-body-s">Taxable</span>
            </label>
            <div className="flex gap-2 self-center pt-5">
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
              <p className="w-full text-caption font-medium text-crit" role="alert">
                {state.error}
              </p>
            ) : null}
          </div>
        </form>
      </LTd>
    </tr>
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
  // Same defaultChecked/native-reset problem as EditableRow's taxable
  // checkbox (see its comment): make it controlled and post the real value
  // through a hidden input, rather than trust the checkbox's own form
  // participation to survive React 19's post-action reset.
  const [taxable, setTaxable] = useState(taxableChecked);
  useEffect(() => {
    setTaxable(taxableChecked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);
  // Same controlled-plus-hidden-input pattern as the checkbox above: `name`
  // dropped from the visible select, the real value posted from a
  // controlled hidden input instead — the native `<select>` still
  // participates directly in the browser's native form "reset" event React
  // 19 fires after every action dispatch (including a rejected one), which
  // restores whichever `<option>` was marked selected at mount rather than
  // this control's live state, and a rejected add must not silently revert
  // the line type to "Other".
  const [lineType, setLineType] = useState(() =>
    submitted?.line_type !== undefined ? String(submitted.line_type) : "other"
  );
  useEffect(() => {
    if (submitted?.line_type !== undefined) setLineType(String(submitted.line_type));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  return (
    <form action={formAction}>
      <div className="mt-2 flex flex-wrap items-start gap-3">
        <input type="hidden" name="invoice_id" value={invoiceId} />
        <div className="w-40">
          <LField label="Type" htmlFor="add-line-type">
            <LSelect
              id="add-line-type"
              value={lineType}
              onChange={(e) => setLineType(e.target.value)}
            >
              {MANUAL_LINE_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </LSelect>
          </LField>
          <input type="hidden" name="line_type" value={lineType} />
        </div>
        <div className="flex-1 basis-56">
          <LField label="Description" htmlFor="add-line-description">
            <LInput
              id="add-line-description"
              name="description"
              placeholder="Description"
              defaultValue={submitted?.description !== undefined ? String(submitted.description) : ""}
            />
          </LField>
        </div>
        <div className="w-20">
          <LField label="Qty" htmlFor="add-line-quantity">
            <LInput
              id="add-line-quantity"
              name="quantity"
              placeholder="Qty"
              defaultValue={submitted?.quantity !== undefined ? String(submitted.quantity) : "1"}
            />
          </LField>
        </div>
        <div className="w-28">
          <LField label="Unit (USD)" htmlFor="add-line-unit-amount">
            <LInput
              id="add-line-unit-amount"
              name="unit_amount"
              placeholder="Unit (USD)"
              defaultValue={submitted?.unit_amount !== undefined ? String(submitted.unit_amount) : ""}
            />
          </LField>
        </div>
        <label className="flex items-center gap-2 self-center pt-5">
          <input type="hidden" name="taxable" value={taxable ? "on" : "off"} />
          <LCheckbox checked={taxable} onChange={(e) => setTaxable(e.target.checked)} />
          <span className="text-body-s">Taxable</span>
        </label>
        <div className="self-center pt-5">
          <LButton type="submit" variant="outline" size="sm" disabled={pending}>
            {pending ? "Adding…" : "Add line"}
          </LButton>
        </div>
        {state.error ? (
          <p className="w-full text-caption font-medium text-crit" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function RebillRow({
  invoiceId,
  expense,
  categoryLabels,
}: {
  invoiceId: string;
  expense: RebillableExpense;
  categoryLabels: Record<string, string>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const label = categoryLabels[expense.category] ?? categoryLabel(expense.category);

  return (
    <div className="flex items-center gap-4">
      <p className="flex-1 text-ink-3">
        {label} {expense.vendor ? `· ${expense.vendor}` : ""} (
        {formatDate(expense.incurred_on)}) · <span className="tnum-l">{formatCents(expense.amount_cents)}</span>
      </p>
      <LButton
        type="button"
        variant="outline"
        disabled={pending || added}
        aria-label={`Add to invoice: ${label}${
          expense.vendor ? `, ${expense.vendor}` : ""
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
      </LButton>
      {error ? (
        <p className="text-caption text-crit" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
