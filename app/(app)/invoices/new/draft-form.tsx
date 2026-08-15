"use client";

import { useActionState, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import NextLink from "next/link";
import { LButton, LCard, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { LCheckbox, LField, LInput } from "@/components/ledger/forms";
import { formatCents, formatDateRange } from "@/lib/format";
import type { InvoiceFormState } from "../actions";
import BillToFields, {
  EMPTY_BILL_TO,
  TYPED_VALUE,
  type BillToValues,
  type ClientOption,
} from "../bill-to-fields";

export type { ClientOption };

export type TripOption = {
  id: string;
  starts_on: string;
  ends_on: string;
  aircraft_ident: string | null;
  day_rate_cents: number;
  day_count: number;
  travel_day_count: number;
  travel_day_rate_cents: number | null;
  rebillable_expense_cents: number;
  estimated_value_cents: number;
  missing_travel_rate: boolean;
  /** Whether estimated_value_cents was derived from this trip's day-by-day
   * grid (pilot.trip_days) rather than day_count/day_rate_cents — shown
   * as a caption so a pilot who edited the grid understands why the
   * figure moved. */
  has_day_rows: boolean;
  /** The label of a live (non-void) invoice already billing this trip —
   * pilot.trip_committed_invoice — or null. Set when the trip's
   * billing_state still reads 'unbilled' (it only advances on an invoice
   * STATUS change) but it's already sitting on someone else's live
   * invoice, including a draft. */
  committed_invoice_label: string | null;
};

const initialState: InvoiceFormState = { error: null };

/**
 * WHAT THIS FORM STOPPED REQUIRING.
 *
 * It used to refuse to submit without BOTH a client and at least one selected
 * trip. Neither was ever a database rule: createInvoiceDraft has always
 * accepted an empty trip list and produced a header-only draft, and lines can
 * be typed on the invoice screen. The two disabled conditions were the whole
 * reason a pilot could not bill anything that was not a logged trip for a
 * saved client.
 *
 * Both are gone. A bill-to is still required, because an invoice addressed to
 * nobody cannot be sent, and that is now answerable two ways: a saved client,
 * or details typed on the invoice itself.
 *
 * The bill-to picker is a native `<select>` (components/ledger/forms.tsx's
 * LSelect) with a leading, disabled placeholder option, so "nothing chosen
 * yet" is still the empty string in this component's state and the
 * placeholder stands in for it; TYPED_VALUE (../bill-to-fields.tsx) is the
 * clientless option.
 */
export default function DraftForm({
  action,
  clients,
  selectedClientId,
  trips,
  tripsError,
  unmarkedTripCount = 0,
  unmarkedTripCountFailed = false,
}: {
  action: (state: InvoiceFormState, formData: FormData) => Promise<InvoiceFormState>;
  clients: ClientOption[];
  selectedClientId: string;
  trips: TripOption[];
  /** Set when the trips/expenses query failed — must render as an error,
   * never as "this client has no billable trips", which is what an empty
   * array and a failed read are otherwise indistinguishable from. */
  tripsError?: string | null;
  /**
   * Trips for this client sitting at Scheduled / In progress. An empty
   * picker is ambiguous — no work done, or work done and never marked
   * flown — and saying only the first is how a pilot with a month of
   * unbilled flying got told they had nothing.
   */
  unmarkedTripCount?: number;
  /** Set when the scheduled/in-progress count itself failed. `trips.length
   * === 0 && unmarkedTripCount === 0` is then not "genuinely nothing to
   * bill" but "the count that would have said otherwise didn't come
   * back" — the two must not render the same "No completed, unbilled
   * trips" sentence. */
  unmarkedTripCountFailed?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, formAction, pending] = useActionState(action, initialState);
  const [selectedTrips, setSelectedTrips] = useState<Set<string>>(new Set());
  // M13: picking a client does a router.push to `/invoices/new?client=…`,
  // which remounts this component and resets useActionState — so a tax
  // rate typed BEFORE choosing a client used to vanish silently, since
  // state.values (the only other source TextField's defaultValue reads)
  // is also gone on remount. Carried through the navigation in the URL's
  // own `tax_rate` query param instead: seeded here on mount/remount, kept
  // in sync as the pilot types (onChange, not just on submit), and pushed
  // back into the URL every time pickClient navigates, so it survives the
  // exact remount that used to erase it.
  const [taxRate, setTaxRate] = useState(
    () => state.values?.tax_rate_percent ?? searchParams.get("tax_rate") ?? ""
  );

  // WHO THIS BILLS. Seeded from the URL (which is what the page's trip read
  // is keyed on) and, when the pilot picks the clientless option, held purely
  // in component state.
  const [selection, setSelection] = useState(() =>
    selectedClientId !== "" ? selectedClientId : ""
  );
  const [billTo, setBillTo] = useState<BillToValues>(EMPTY_BILL_TO);

  /**
   * PICKING A CLIENT NAVIGATES; PICKING "no client" DOES NOT.
   *
   * The navigation exists for one reason: the server has to read THAT
   * client's unbilled trips, and it reads them from `?client=`. The clientless
   * option has no trips to read, so it needs no round trip, and not making one
   * is what lets the typed address block survive being typed: a router.push
   * remounts this component and resets both useActionState and every piece of
   * state below, which is the same remount the tax rate is already carried
   * through the URL to survive. Nine address fields in a query string would be
   * the wrong answer to that problem.
   */
  function pickBillTo(next: string) {
    setSelection(next);
    if (next === TYPED_VALUE) {
      // Trips belong to a client; none can be billed on a clientless invoice
      // (invoice_lines_validate_trip refuses it), so any selection is dropped
      // rather than silently submitted and rejected.
      setSelectedTrips(new Set());
      return;
    }
    setSelectedTrips(new Set());
    setBillTo(EMPTY_BILL_TO);
    const params = new URLSearchParams();
    if (next) params.set("client", next);
    if (taxRate.trim() !== "") params.set("tax_rate", taxRate);
    const qs = params.toString();
    router.push(qs ? `/invoices/new?${qs}` : "/invoices/new");
  }

  function toggleTrip(trip: TripOption) {
    // Defence in depth alongside the checkbox's own `disabled` — a trip
    // already committed to a live invoice elsewhere can never enter
    // selection, so a stray toggle can't put it on the submitted
    // trip_ids list regardless of how it was triggered.
    if (trip.committed_invoice_label !== null) return;
    setSelectedTrips((prev) => {
      const next = new Set(prev);
      if (next.has(trip.id)) next.delete(trip.id);
      else next.add(trip.id);
      return next;
    });
  }

  const selectedValueCents = trips
    .filter((t) => selectedTrips.has(t.id))
    .reduce((sum, t) => sum + t.estimated_value_cents, 0);

  return (
    <LCard>
      <form action={formAction}>
        {/* client_id and bill_to_mode are posted by BillToFields itself. */}
        {[...selectedTrips].map((id) => (
          <input key={id} type="hidden" name="trip_ids" value={id} />
        ))}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1 md:col-span-2">
            <BillToFields
              clients={clients}
              selection={selection}
              onSelectionChange={pickBillTo}
              values={billTo}
              onValueChange={(field, next) =>
                setBillTo((prev) => ({ ...prev, [field]: next }))
              }
              clientHint={
                clients.length === 0
                  ? "No active clients yet. Pick “No client” and type the details, or add a client first."
                  : undefined
              }
            />
          </div>
          <LField
            label="Tax rate (%)"
            htmlFor="tax_rate_percent"
            hint="State sales or service tax, if any"
          >
            <LInput
              id="tax_rate_percent"
              name="tax_rate_percent"
              inputMode="decimal"
              className="tnum-l"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
            />
          </LField>
        </div>

        {selection !== "" && selection !== TYPED_VALUE ? (
          <div className="mt-6 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-h3 font-semibold">Unbilled trips</h2>
              {selectedTrips.size > 0 ? (
                <p className="tnum-l text-body-s text-ink-2">
                  {selectedTrips.size} selected · est. {formatCents(selectedValueCents)}
                </p>
              ) : null}
            </div>

            {tripsError ? (
              <p className="text-body-s text-crit" role="alert">
                {tripsError}
              </p>
            ) : trips.length === 0 ? (
              <p className="text-body-s text-ink-2">
                {unmarkedTripCount > 0
                  ? `No trips are marked flown for this client yet. ${unmarkedTripCount} ${
                      unmarkedTripCount === 1 ? "is" : "are"
                    } still Scheduled. Open the trip and press "Mark flown" to bill it.`
                  : unmarkedTripCountFailed
                    ? "Couldn't check whether this client has trips still marked Scheduled. This is not a statement that none are waiting."
                    : "No completed, unbilled trips for this client yet."}
              </p>
            ) : (
              <LTable>
                <caption>
                  <span className="sr-only">Unbilled trips</span>
                </caption>
                <thead>
                  <tr>
                    <LTh>
                      <span className="sr-only">Select</span>
                    </LTh>
                    <LTh>Dates</LTh>
                    <LTh>Aircraft</LTh>
                    <LTh numeric>Flight days</LTh>
                    <LTh numeric>Travel days</LTh>
                    <LTh numeric>Rebill</LTh>
                    <LTh numeric>Est. value</LTh>
                  </tr>
                </thead>
                <tbody>
                  {trips.map((trip) => {
                    const disabled = trip.committed_invoice_label !== null;
                    return (
                      <tr key={trip.id} style={disabled ? { opacity: 0.55 } : undefined}>
                        <LTd>
                          <LCheckbox
                            checked={selectedTrips.has(trip.id)}
                            onChange={() => toggleTrip(trip)}
                            disabled={disabled}
                          />
                        </LTd>
                        <LTd>
                          <span>{formatDateRange(trip.starts_on, trip.ends_on)}</span>
                          {disabled ? (
                            <span className="block text-caption text-warn">
                              {`Already on ${trip.committed_invoice_label}`}
                            </span>
                          ) : null}
                        </LTd>
                        <LTd>
                          <span className="text-ink-2">{trip.aircraft_ident ?? "—"}</span>
                        </LTd>
                        <LTd numeric>
                          {trip.has_day_rows ? (
                            <span className="text-ink-2">From day grid</span>
                          ) : (
                            <span>
                              {trip.day_count} × {formatCents(trip.day_rate_cents)}
                            </span>
                          )}
                        </LTd>
                        <LTd numeric>
                          {trip.has_day_rows ? (
                            <span className="text-ink-2">N/A</span>
                          ) : (
                            <span className={trip.missing_travel_rate ? "text-warn" : "text-ink-2"}>
                              {trip.travel_day_count > 0
                                ? trip.missing_travel_rate
                                  ? `${trip.travel_day_count} × no rate set`
                                  : `${trip.travel_day_count} × ${formatCents(
                                      trip.travel_day_rate_cents
                                    )}`
                                : "—"}
                            </span>
                          )}
                        </LTd>
                        <LTd numeric>
                          <span className="text-ink-2">
                            {trip.rebillable_expense_cents > 0
                              ? formatCents(trip.rebillable_expense_cents)
                              : "—"}
                          </span>
                        </LTd>
                        <LTd numeric>
                          <span className="font-medium">{formatCents(trip.estimated_value_cents)}</span>
                          {trip.has_day_rows ? (
                            <span
                              className="block text-caption text-ink-3"
                              title="Priced from this trip's day-by-day grid (quantity × rate for each billable day), not the trip's flat day count/rate."
                            >
                              from day grid
                            </span>
                          ) : null}
                        </LTd>
                      </tr>
                    );
                  })}
                </tbody>
              </LTable>
            )}
          </div>
        ) : null}

        {
          // THIS USED TO BLOCK THE SUBMIT, and blocking it was the bug.
          //
          // The original reasoning: a header-only draft has no lines, the
          // migration refuses to SEND an invoice with no lines, so a draft
          // with nothing on it is a dead end the pilot only discovers later.
          // The premise was right and the conclusion was wrong. Lines can be
          // added by hand on the invoice screen (LinesEditor has done this
          // since it shipped), so a header-only draft is not a dead end, it
          // is the ordinary starting point for anything that is not a logged
          // trip: a one-off ferry, a training day, a cancellation fee, a
          // deposit.
          //
          // So it says what happens next instead of preventing it. The dead
          // end the original comment worried about is still closed, by the
          // send button on the invoice screen, which is where the invoice
          // actually has lines or does not.
        }
        {selection !== "" && selectedTrips.size === 0 ? (
          <p className="mt-3 text-caption text-ink-3">
            No trips selected. You will get an empty invoice and add its lines
            yourself on the next screen.
          </p>
        ) : null}

        <div className="mt-4" role="alert" aria-live="polite">
          {state.error ? <p className="text-caption text-crit">{state.error}</p> : null}
        </div>

        <div className="mt-4 flex gap-3">
          <LButton
            type="submit"
            // A bill-to is the only requirement: either a client is picked, or
            // the clientless option is, in which case readBillTo checks the
            // typed name server-side and says so if it is missing. Trips are
            // no longer required at all.
            disabled={pending || selection === ""}
          >
            {pending ? "Drafting…" : "Draft invoice"}
          </LButton>
          <NextLink href="/invoices" className={lButtonClass({ variant: "outline" })}>
            Cancel
          </NextLink>
        </div>
      </form>
    </LCard>
  );
}
