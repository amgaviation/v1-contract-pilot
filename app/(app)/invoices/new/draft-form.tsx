"use client";

import { useActionState, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import NextLink from "next/link";
import {
  Button,
  Card,
  Checkbox,
  Flex,
  Grid,
  Table,
  Text,
  TextField,
} from "@/components/ui";
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
 * Radix Select forbids an empty-string item value, so "nothing chosen yet" is
 * still the empty string in this component's state and the placeholder stands
 * in for it; TYPED_VALUE (../bill-to-fields.tsx) is the clientless option.
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
    <Card size="3">
      <form action={formAction}>
        {/* client_id and bill_to_mode are posted by BillToFields itself. */}
        {[...selectedTrips].map((id) => (
          <input key={id} type="hidden" name="trip_ids" value={id} />
        ))}

        <Grid columns={{ initial: "1", md: "3" }} gap="4">
          <Flex direction="column" gap="1" gridColumn={{ md: "span 2" }}>
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
                  ? "No active clients yet. Pick \u201cNo client\u201d and type the details, or add a client first."
                  : undefined
              }
            />
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
              State sales or service tax, if any
            </Text>
          </Flex>
        </Grid>

        {selection !== "" && selection !== TYPED_VALUE ? (
          <Flex direction="column" gap="3" mt="6">
            <Flex justify="between" align="center">
              <Text size="4" weight="bold">
                Unbilled trips
              </Text>
              {selectedTrips.size > 0 ? (
                <Text size="2" color="gray">
                  {selectedTrips.size} selected · est. {formatCents(selectedValueCents)}
                </Text>
              ) : null}
            </Flex>

            {tripsError ? (
              <Text size="2" color="red" role="alert">
                {tripsError}
              </Text>
            ) : trips.length === 0 ? (
              <Text size="2" color="gray">
                {unmarkedTripCount > 0
                  ? `No trips are marked flown for this client yet. ${unmarkedTripCount} ${
                      unmarkedTripCount === 1 ? "is" : "are"
                    } still Scheduled. Open the trip and press "Mark flown" to bill it.`
                  : unmarkedTripCountFailed
                    ? "Couldn't check whether this client has trips still marked Scheduled. This is not a statement that none are waiting."
                    : "No completed, unbilled trips for this client yet."}
              </Text>
            ) : (
              <Table.Root variant="ghost">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell />
                    <Table.ColumnHeaderCell>Dates</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Aircraft</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Flight days</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Travel days</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Rebill</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Est. value</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {trips.map((trip) => {
                    const disabled = trip.committed_invoice_label !== null;
                    return (
                      <Table.Row key={trip.id} style={disabled ? { opacity: 0.55 } : undefined}>
                        <Table.Cell>
                          <Checkbox
                            checked={selectedTrips.has(trip.id)}
                            onCheckedChange={() => toggleTrip(trip)}
                            disabled={disabled}
                          />
                        </Table.Cell>
                        <Table.Cell>
                          <Text>{formatDateRange(trip.starts_on, trip.ends_on)}</Text>
                          {disabled ? (
                            <Text as="div" size="1" color="amber">
                              Already on {trip.committed_invoice_label}
                            </Text>
                          ) : null}
                        </Table.Cell>
                        <Table.Cell>
                          <Text color="gray">{trip.aircraft_ident ?? "—"}</Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          {trip.has_day_rows ? (
                            <Text color="gray">From day grid</Text>
                          ) : (
                            <Text className="tnum">
                              {trip.day_count} × {formatCents(trip.day_rate_cents)}
                            </Text>
                          )}
                        </Table.Cell>
                        <Table.Cell justify="end">
                          {trip.has_day_rows ? (
                            <Text color="gray">N/A</Text>
                          ) : (
                            <Text
                              className="tnum"
                              color={trip.missing_travel_rate ? "amber" : "gray"}
                            >
                              {trip.travel_day_count > 0
                                ? trip.missing_travel_rate
                                  ? `${trip.travel_day_count} × no rate set`
                                  : `${trip.travel_day_count} × ${formatCents(
                                      trip.travel_day_rate_cents
                                    )}`
                                : "—"}
                            </Text>
                          )}
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Text color="gray" className="tnum">
                            {trip.rebillable_expense_cents > 0
                              ? formatCents(trip.rebillable_expense_cents)
                              : "—"}
                          </Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Text weight="medium" className="tnum">
                            {formatCents(trip.estimated_value_cents)}
                          </Text>
                          {trip.has_day_rows ? (
                            <Text
                              as="div"
                              size="1"
                              color="gray"
                              title="Priced from this trip's day-by-day grid (quantity × rate for each billable day), not the trip's flat day count/rate."
                            >
                              from day grid
                            </Text>
                          ) : null}
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>
            )}
          </Flex>
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
          <Text as="div" size="1" color="gray" mt="3">
            No trips selected. You will get an empty invoice and add its lines
            yourself on the next screen.
          </Text>
        ) : null}

        <Flex mt="4" role="alert" aria-live="polite">
          {state.error ? (
            <Text size="1" color="red">
              {state.error}
            </Text>
          ) : null}
        </Flex>

        <Flex mt="4" gap="3">
          <Button
            type="submit"
            // A bill-to is the only requirement: either a client is picked, or
            // the clientless option is, in which case readBillTo checks the
            // typed name server-side and says so if it is missing. Trips are
            // no longer required at all.
            disabled={pending || selection === ""}
          >
            {pending ? "Drafting…" : "Draft invoice"}
          </Button>
          <Button asChild variant="outline">
            <NextLink href="/invoices">Cancel</NextLink>
          </Button>
        </Flex>
      </form>
    </Card>
  );
}
