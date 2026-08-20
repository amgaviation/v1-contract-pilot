"use client";

import { useActionState, useState } from "react";
import { LButton, LCard } from "@/components/ledger";
import { LCheckbox, LField, LInput, LTextarea } from "@/components/ledger/forms";
import { updateInvoicing, setNextInvoiceNumber } from "./invoicing-actions";
import type { SettingsFormState } from "./actions";

/**
 * THE INVOICING TAB — everything that decides what an invoice looks like
 * before a single line is typed on it.
 *
 * TWO FORMS, NOT ONE, and the split is deliberate rather than a layout
 * accident. The document settings are ordinary preferences: change them,
 * save, change them back. Setting the next number is a one-way action —
 * pilot.set_next_invoice_number only moves forward — and burying a
 * one-way action inside a Save button next to five reversible ones is how
 * a pilot jumps their counter to 9000 while editing their footer.
 *
 * THE LIVE PREVIEW IS THE POINT. Prefix, digits and the year toggle are
 * three fields that combine into one string the pilot cares about and
 * cannot otherwise see until they issue an invoice — at which point the
 * number is immutable. The preview is computed from the CURRENT input
 * values with exactly the concatenation pilot.next_invoice_number performs,
 * so what it shows is what the database will mint. Keeping those two in
 * step is a real obligation: if that function's format changes, this
 * changes with it.
 */

export type InvoicingValues = {
  invoice_prefix?: string | null;
  invoice_number_pad?: number | null;
  invoice_number_include_year?: boolean | null;
  default_tax_rate_bps?: number | null;
  default_invoice_notes?: string | null;
  invoice_footer?: string | null;
};

const initialState: SettingsFormState = { error: null };

export default function InvoicingPanel({
  values,
  nextNumber,
  canEdit,
}: {
  values: InvoicingValues;
  /**
   * The counter's current value — what the NEXT invoice issued will use.
   * Read server-side from pilot.invoice_number_sequences. Null when the
   * row could not be read, in which case the preview says so rather than
   * inventing a number.
   */
  nextNumber: number | null;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateInvoicing, initialState);
  const [seqState, seqAction, seqPending] = useActionState(setNextInvoiceNumber, initialState);

  // React 19 resets an uncontrolled form on every dispatch, the error path
  // included, so a rejected submit would blank every field without the
  // echo. These three are controlled anyway, because the preview reads
  // them live; the echo seeds their initial value.
  const echoed = state.values;
  const seed = (key: keyof InvoicingValues, fallback: string) => {
    const back = echoed?.[key];
    if (back !== undefined) return back;
    const stored = values[key];
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  const [prefix, setPrefix] = useState(() => seed("invoice_prefix", "INV"));
  const [pad, setPad] = useState(() => seed("invoice_number_pad", "4"));
  const [includeYear, setIncludeYear] = useState(() =>
    echoed?.invoice_number_include_year !== undefined
      ? echoed.invoice_number_include_year !== ""
      : values.invoice_number_include_year !== false
  );

  // The same concatenation as pilot.next_invoice_number, on the same
  // inputs. Out-of-range values are clamped for DISPLAY only — the action
  // still rejects them, and a preview that renders nothing while the pilot
  // is mid-keystroke is worse than one that shows the nearest legal shape.
  const padDigits = Math.min(8, Math.max(1, Number(pad) || 4));
  const sample = String(nextNumber ?? 1).padStart(padDigits, "0");
  const preview = `${prefix.toUpperCase() || "INV"}-${
    includeYear ? `${new Date().getFullYear()}-` : ""
  }${sample}`;

  const taxSeed = () => {
    const back = echoed?.default_tax_rate_percent;
    if (back !== undefined) return back;
    const bps = values.default_tax_rate_bps;
    return bps === null || bps === undefined ? "" : String(bps / 100);
  };

  return (
    <div className="flex flex-col gap-4">
      <LCard>
        <form action={formAction}>
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-h3 font-semibold">Invoice numbering</h2>
              <p className="mt-1 text-body-s text-ink-2">
                Numbers are assigned when you send an invoice, not when you
                create the draft. Invoices you have already issued keep the
                number they were issued under — changing anything here
                affects the next one and everything after it.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="md:col-span-4">
                <LField
                  label="Prefix"
                  htmlFor="invoice_prefix"
                  hint="1 to 8 letters or digits"
                >
                  <LInput
                    id="invoice_prefix"
                    name="invoice_prefix"
                    disabled={!canEdit}
                    maxLength={8}
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                  />
                </LField>
              </div>
              <div className="md:col-span-4">
                <LField
                  label="Number length"
                  htmlFor="invoice_number_pad"
                  hint="Digits the count is padded to"
                >
                  <LInput
                    id="invoice_number_pad"
                    name="invoice_number_pad"
                    type="number"
                    min={1}
                    max={8}
                    step={1}
                    disabled={!canEdit}
                    value={pad}
                    onChange={(e) => setPad(e.target.value)}
                  />
                </LField>
              </div>
              <div className="flex items-end md:col-span-4">
                <label
                  htmlFor="invoice_number_include_year"
                  className="flex items-center gap-2 pb-2 text-body-s font-medium text-ink"
                >
                  <LCheckbox
                    id="invoice_number_include_year"
                    name="invoice_number_include_year"
                    value="on"
                    disabled={!canEdit}
                    checked={includeYear}
                    onChange={(e) => setIncludeYear(e.target.checked)}
                  />
                  Include the year
                </label>
              </div>
            </div>

            <div className="rounded-md border border-hair bg-surface-2 px-4 py-3">
              <p className="text-caption text-ink-3">Your next invoice number</p>
              <p className="mt-1 font-mono text-h3 tabular-nums">{preview}</p>
              {nextNumber === null ? (
                <p className="mt-1 text-caption text-ink-3">
                  Showing a count of 1 — your current count couldn&rsquo;t be
                  read just now.
                </p>
              ) : null}
            </div>

            <div>
              <h2 className="text-h3 font-semibold">Invoice defaults</h2>
              <p className="mt-1 text-body-s text-ink-2">
                What a new invoice starts with. You can change any of it on
                the invoice itself before you send it.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="md:col-span-4">
                <LField
                  label="Default tax rate"
                  htmlFor="default_tax_rate_percent"
                  hint="A percent like 8.25. Leave blank for none."
                >
                  <LInput
                    id="default_tax_rate_percent"
                    name="default_tax_rate_percent"
                    inputMode="decimal"
                    disabled={!canEdit}
                    defaultValue={taxSeed()}
                  />
                </LField>
              </div>
              <div className="md:col-span-8">
                <LField
                  label="Default notes"
                  htmlFor="default_invoice_notes"
                  hint="Prefilled into every new invoice’s notes"
                >
                  <LTextarea
                    id="default_invoice_notes"
                    name="default_invoice_notes"
                    rows={3}
                    maxLength={2000}
                    disabled={!canEdit}
                    defaultValue={seed("default_invoice_notes", "")}
                  />
                </LField>
              </div>
              <div className="md:col-span-12">
                <LField
                  label="Invoice footer"
                  htmlFor="invoice_footer"
                  hint="Printed at the bottom of every invoice PDF — remit-to wording, a late-fee sentence, a thank-you. Read live, so a change here shows on every invoice, including ones already issued."
                >
                  <LTextarea
                    id="invoice_footer"
                    name="invoice_footer"
                    rows={3}
                    maxLength={2000}
                    disabled={!canEdit}
                    defaultValue={seed("invoice_footer", "")}
                  />
                </LField>
              </div>
            </div>

            <div role="alert" aria-live="polite">
              {state.error ? (
                <p className="text-caption font-medium text-crit">{state.error}</p>
              ) : state.saved ? (
                <p className="text-caption font-medium text-good">Saved.</p>
              ) : null}
            </div>

            {canEdit ? (
              <div>
                <LButton type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save changes"}
                </LButton>
              </div>
            ) : (
              <p className="text-caption text-ink-3">
                Only the account owner can change these.
              </p>
            )}
          </div>
        </form>
      </LCard>

      <LCard>
        <form action={seqAction}>
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-h3 font-semibold">Set the count</h2>
              <p className="mt-1 text-body-s text-ink-2">
                Moving here from another system? Set the count to carry on
                where your old numbering left off. It can only be moved{" "}
                <strong>forward</strong> — lowering it could re-use a number
                one of your issued invoices already has.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="md:col-span-4">
                <LField
                  label="Next count"
                  htmlFor="next_invoice_number"
                  hint={
                    nextNumber === null
                      ? "Your current count couldn’t be read."
                      : `Currently ${nextNumber}`
                  }
                >
                  <LInput
                    id="next_invoice_number"
                    name="next_invoice_number"
                    type="number"
                    min={1}
                    step={1}
                    disabled={!canEdit}
                    defaultValue={
                      seqState.values?.next_invoice_number ?? String(nextNumber ?? "")
                    }
                  />
                </LField>
              </div>
            </div>

            <div role="alert" aria-live="polite">
              {seqState.error ? (
                <p className="text-caption font-medium text-crit">{seqState.error}</p>
              ) : seqState.saved ? (
                <p className="text-caption font-medium text-good">
                  Saved. Your next invoice will use it.
                </p>
              ) : null}
            </div>

            {canEdit ? (
              <div>
                <LButton type="submit" variant="outline" disabled={seqPending}>
                  {seqPending ? "Saving…" : "Set the count"}
                </LButton>
              </div>
            ) : null}
          </div>
        </form>
      </LCard>
    </div>
  );
}
