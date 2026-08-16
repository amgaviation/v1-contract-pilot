"use client";

import { useActionState, useState, useTransition } from "react";
import NextLink from "next/link";
import { LAlert, LButton, LCard, LEmpty, LTable, LTd, LTh } from "@/components/ledger";
import { LField, LInput } from "@/components/ledger/forms";
import type { Database } from "@/lib/supabase/database.types";
import { saveMileageRate, deleteMileageRate, type MileageRateFormState } from "./mileage-rates-actions";

type MileageRateRow = Database["pilot"]["Tables"]["mileage_rates"]["Row"];

const initialState: MileageRateFormState = { error: null };

/** cents-per-mile with up to 3 fractional-cent digits → a display string. */
function formatRate(rate: number): string {
  // Trim trailing zeros beyond what was actually entered, but keep at
  // least one digit after the point when there is a fraction — this is
  // display only, never fed back into a form or a computation.
  return `${rate.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}¢/mi`;
}

/**
 * Lets the pilot record the standard mileage rate for each tax year, so
 * pilot.mileage_entries has something to snapshot at capture. This panel
 * NEVER shows a pre-filled or suggested figure — see mileage-rates-
 * actions.ts and the migration header for why a hardcoded or guessed rate
 * is worse than an empty field. The IRS publishes the current and historical
 * rates at the link below.
 *
 * A MONEY SURFACE (docs/design/LEDGER.md): tax year and rate both carry
 * `tnum-l`, and the table's first cell is the same row-header idiom the
 * other Ledger tables use.
 */
export default function MileageRatesPanel({
  rates,
  canEdit,
}: {
  rates: MileageRateRow[];
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveMileageRate, initialState);
  const [removing, startRemove] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);

  const submitted = state.values;
  const initial = (key: string, fallback = "") => {
    const echoed = submitted?.[key];
    return echoed === undefined ? fallback : echoed;
  };

  const currentYear = new Date().getUTCFullYear();
  const sorted = [...rates].sort((a, b) => b.tax_year - a.tax_year);

  return (
    <LCard>
      <div className="flex flex-col gap-4">
        <h3 className="text-h3 font-semibold text-ink">Mileage rates</h3>

        <LAlert tone="accent" className="flex items-start gap-2">
          <InfoIcon className="mt-0.5 shrink-0 text-accent" />
          <span>
            Look up the current and historical rates at{" "}
            <a
              href="https://www.irs.gov/tax-professionals/standard-mileage-rates"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              irs.gov/tax-professionals/standard-mileage-rates
            </a>
            . This product never fills in a figure for you. A stale or guessed rate would
            silently misstate a real deduction.
          </span>
        </LAlert>

        {/* LEmpty, like every other empty region in the product. No action
            button here on purpose: the add form is already the next thing
            on the screen, and the alert above it is the one that must be
            read first — this product never fills in a mileage rate for
            you. */}
        {sorted.length === 0 ? (
          <LEmpty title="No rates recorded yet">
            Add the IRS standard mileage rate for each tax year you claim, and every
            mileage entry from that year is priced from it. Nothing is calculated
            until a rate for the year exists.
          </LEmpty>
        ) : (
          <LTable>
            <caption>
              <span className="sr-only">Mileage rates</span>
            </caption>
            <thead>
              <tr>
                <LTh>Tax year</LTh>
                <LTh numeric>Rate</LTh>
                <LTh>Notes</LTh>
                {canEdit ? <LTh /> : null}
              </tr>
            </thead>
            <tbody>
              {sorted.map((rate) => (
                <tr key={rate.id}>
                  <th
                    scope="row"
                    className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                  >
                    <span className="tnum-l">{rate.tax_year}</span>
                  </th>
                  <LTd numeric>{formatRate(rate.rate_cents_per_mile)}</LTd>
                  <LTd>
                    <span className="text-ink-2">{rate.notes ?? "—"}</span>
                  </LTd>
                  {canEdit ? (
                    <LTd>
                      <LButton
                        type="button"
                        variant="quiet"
                        size="sm"
                        disabled={removing}
                        className="text-crit hover:bg-crit-soft"
                        onClick={() =>
                          startRemove(async () => {
                            setRowError(null);
                            const result = await deleteMileageRate(rate.id);
                            if (result.error) setRowError(result.error);
                          })
                        }
                      >
                        {removing ? "Removing…" : "Remove"}
                      </LButton>
                    </LTd>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </LTable>
        )}

        {rowError ? (
          <p className="text-caption font-medium text-crit" role="alert">
            {rowError}
          </p>
        ) : null}

        {canEdit ? (
          <form action={formAction}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <LField label="Tax year" htmlFor="mileage-tax-year" className="w-32">
                  <LInput
                    id="mileage-tax-year"
                    name="tax_year"
                    type="number"
                    required
                    className="tnum-l"
                    placeholder={String(currentYear)}
                    defaultValue={initial("tax_year")}
                  />
                </LField>
                <LField label="Rate (cents/mile)" htmlFor="mileage-rate" className="w-40">
                  {/* The placeholder carries NO example figure, deliberately.
                      Any plausible number sitting in this box reads as a
                      suggested rate, and the IRS rate changes every year — a
                      stale one that looks authoritative is the exact failure
                      this pilot-entered field exists to avoid. */}
                  <LInput
                    id="mileage-rate"
                    name="rate_cents_per_mile"
                    inputMode="decimal"
                    required
                    className="tnum-l"
                    placeholder="cents per mile"
                    defaultValue={initial("rate_cents_per_mile")}
                  />
                </LField>
                <LField label="Notes" htmlFor="mileage-notes" className="min-w-[12rem] flex-1">
                  <LInput
                    id="mileage-notes"
                    name="notes"
                    placeholder="Optional"
                    defaultValue={initial("notes")}
                  />
                </LField>
                <LButton type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save rate"}
                </LButton>
              </div>

              <div role="alert" aria-live="polite">
                {state.error ? (
                  <p className="text-caption font-medium text-crit">{state.error}</p>
                ) : state.saved ? (
                  <p className="text-caption font-medium text-good">Saved.</p>
                ) : null}
              </div>

              <p className="text-body-s text-ink-3">
                Saving a year that already has a rate replaces it. Drives already logged keep the
                rate they were captured with. See the{" "}
                <NextLink
                  href="/expenses/mileage"
                  className="font-medium text-accent underline-offset-2 hover:underline"
                >
                  mileage log
                </NextLink>
                .
              </p>
            </div>
          </form>
        ) : (
          <p className="text-body-s text-ink-3">Only the account owner can change mileage rates.</p>
        )}
      </div>
    </LCard>
  );
}

/* ── Inline icon ───────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see invoices/page.tsx's own
 * header rule. aria-hidden, stroke="currentColor" so it inherits its
 * caller's tone utility. */
function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v3.5" />
      <circle cx="8" cy="5.25" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
