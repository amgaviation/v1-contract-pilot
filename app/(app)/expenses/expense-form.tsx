"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import { LAlert, LButton, LCard, lButtonClass } from "@/components/ledger";
import { LField, LInput, LSelect, LTextarea } from "@/components/ledger/forms";
import { centsToInput } from "@/lib/format";
import { clientIdForStorage } from "@/lib/expense-client";
import { matchTrip } from "@/lib/receipt-ocr/match-trip";
import ReceiptScan, { type ScanOutcome } from "./receipt-scan";
import type { OptionChoice } from "@/lib/custom-options";
import type { ExpenseFormState } from "./actions";

export type ExpenseFormValues = {
  id?: string;
  incurred_on?: string | null;
  category?: string | null;
  vendor?: string | null;
  amount_cents?: number | null;
  treatment?: string | null;
  trip_id?: string | null;
  client_id?: string | null;
  notes?: string | null;
  receipt_path?: string | null;
};

export type TripOption = {
  id: string;
  label: string;
  clientId: string | null;
  clientName: string | null;
  defaultTreatment: string | null;
  /** For matching a scanned receipt's tail number to the trip it belongs to. */
  aircraftIdent: string | null;
  startsOn: string;
  endsOn: string;
};

export type ClientOption = { id: string; name: string };

const TREATMENTS = [
  { value: "unassigned", label: "Decide later" },
  { value: "rebill", label: "Rebill to the client" },
  { value: "deduct", label: "Keep as a deduction" },
];

// "No trip" uses this sentinel and is translated back to "" on submit, so
// the FormData field name (`trip_id`) never changes and actions.ts's
// optionalUuid() still reads a blank trip exactly as before.
const NO_TRIP = "none";
/** Same sentinel trick for the Client picker, translated back to "" on submit. */
const NO_CLIENT = "none";

const initialState: ExpenseFormState = { error: null };

/** A field the scan read but did not overwrite, because the pilot had typed one. */
type ScanConflict = { field: "incurred_on" | "vendor" | "amount"; label: string; scanned: string };

export default function ExpenseForm({
  action,
  trips,
  clients,
  categories,
  values = {},
  submitLabel,
}: {
  action: (
    state: ExpenseFormState,
    formData: FormData
  ) => Promise<ExpenseFormState>;
  trips: TripOption[];
  /**
   * Who the pilot can attribute a trip-less cost to. Archived clients are
   * already dropped upstream (loadClientOptions), same as every other
   * client picker in the product.
   */
  clients: ClientOption[];
  /**
   * The tenant's own expense-category vocabulary — their labels, their
   * order, retired categories already dropped. Read server-side by the
   * page (lib/custom-options-read.ts) and passed in: this is a client
   * component and the options table is only readable on the server.
   * REQUIRED, not optional, so a new screen rendering this form cannot
   * quietly fall back to the stock list.
   */
  categories: readonly OptionChoice[];
  values?: ExpenseFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  const submitted = state.values;
  // Reads the echoed value from a rejected submit if there is one, else
  // the stored row. Only meaningful for fields that are UNCONTROLLED
  // (`notes`, below) and for the mount-time seed of the controlled ones:
  // a useState initialiser runs once, at mount, when `submitted` is always
  // undefined. For a controlled field the state IS the echo — it survives
  // the action dispatch because React re-renders rather than remounting.
  // Kept explicit because the next reader will otherwise "fix" this into
  // an effect and reintroduce the reset bug it exists to avoid.
  const initial = (key: string, stored: unknown, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  // Treatment and trip are controlled together: "rebill" is only
  // meaningful with a trip attached (the database refuses the pair), so
  // the trip field becomes required in front of the pilot rather than
  // after a round trip.
  const [category, setCategory] = useState(() => initial("category", values.category, "other"));
  // "other" is not a proxy for "untouched" — it is a real answer a pilot
  // picks deliberately, and a Signature Flight Support HANGAR RENTAL filed
  // as Other used to flip silently to Fuel the moment they scanned it.
  // Tracked the same way `treatmentTouched` already is.
  const [categoryTouched, setCategoryTouched] = useState(
    () => submitted?.category !== undefined
  );
  const tripsById = new Map(trips.map((trip) => [trip.id, trip]));

  // The three free-text fields are controlled for the same reason the
  // selects are steered by hand, plus one more: receipt scanning writes
  // into them. A `defaultValue` input cannot be filled from outside after
  // mount without reaching into the DOM, and React 19's post-action reset
  // would then discard whatever was written on a rejected submit. Held in
  // state, the scanned value survives an error round trip and is what
  // actually posts.
  const [incurredOn, setIncurredOn] = useState(() => initial("incurred_on", values.incurred_on));
  const [vendor, setVendor] = useState(() => initial("vendor", values.vendor));
  const [amount, setAmount] = useState(() =>
    initial(
      "amount",
      values.amount_cents === null || values.amount_cents === undefined
        ? null
        : centsToInput(values.amount_cents)
    )
  );

  // H7: the client already answers "rebill or deduct?" on its own record
  // (default_expense_treatment) — a brand-new expense that arrives with a
  // trip already picked (preselected via ?trip=, or the pilot's own first
  // choice) should DEFAULT to that answer instead of hardcoding
  // "unassigned" and making the pilot re-decide something the product
  // already knows. `treatmentTouched` is what keeps it a default rather
  // than a forced value: once the pilot changes the Treatment select
  // themselves, the trip-driven default stops overwriting it, including
  // if they go on to change the trip again.
  const isNew = !values.id;
  const [treatment, setTreatment] = useState(() => {
    if (submitted?.treatment !== undefined) return submitted.treatment;
    if (values.treatment !== undefined && values.treatment !== null) {
      return values.treatment;
    }
    if (isNew && values.trip_id) {
      const preselected = tripsById.get(values.trip_id);
      if (preselected?.defaultTreatment) return preselected.defaultTreatment;
    }
    return "unassigned";
  });
  const [treatmentTouched, setTreatmentTouched] = useState(
    () => submitted?.treatment !== undefined
  );
  const [tripId, setTripId] = useState(() => {
    const stored = submitted?.trip_id ?? values.trip_id ?? "";
    return stored === "" ? NO_TRIP : stored;
  });
  // The client the pilot picked THEMSELVES, which only applies while no
  // trip is chosen. Held separately from what the field displays so that
  // picking a trip and then removing it restores their choice instead of
  // silently losing it.
  const [chosenClientId, setChosenClientId] = useState(() => {
    const stored = submitted?.client_id ?? values.client_id ?? "";
    return stored === "" ? NO_CLIENT : stored;
  });
  const [conflicts, setConflicts] = useState<ScanConflict[]>([]);
  const [tripHint, setTripHint] = useState<string | null>(null);
  const rebilling = treatment === "rebill";
  const selectedTrip = tripId === NO_TRIP ? null : tripsById.get(tripId) ?? null;

  // A trip DECIDES the client. The database will not store an expense whose
  // client disagrees with its trip's (composite FK on (account_id, trip_id,
  // client_id)), and the server action re-derives this from the trip
  // anyway, so the field is shown filled and disabled rather than left
  // editable and then quietly overruled.
  const tripDecidesClient = selectedTrip !== null;
  // What the picker SHOWS. With a trip, that is the trip's client, which is
  // a display of a derived fact rather than a value this form stores.
  const effectiveClientId = tripDecidesClient
    ? selectedTrip.clientId ?? NO_CLIENT
    : chosenClientId;
  // What the form STORES, which is null for anything with a trip.
  const storedClientId = clientIdForStorage(
    chosenClientId === NO_CLIENT ? null : chosenClientId,
    tripDecidesClient
  );
  const clientsById = new Map(clients.map((client) => [client.id, client.name]));
  // A client that no longer appears in the picker (archived since this
  // expense was filed) still has to render as itself, not as "No client" --
  // the picker would otherwise show an empty selection for a real
  // attribution.
  const missingClientName =
    effectiveClientId !== NO_CLIENT && !clientsById.has(effectiveClientId)
      ? selectedTrip?.clientName ?? "Client no longer listed"
      : null;

  const handleTreatmentChange = (next: string) => {
    setTreatment(next);
    setTreatmentTouched(true);
  };

  const applyTripDefault = (next: string) => {
    if (!isNew || treatmentTouched) return;
    const trip = next === NO_TRIP ? null : tripsById.get(next) ?? null;
    if (trip?.defaultTreatment) setTreatment(trip.defaultTreatment);
  };

  const handleTripChange = (next: string) => {
    setTripId(next);
    setTripHint(null);
    applyTripDefault(next);
  };

  /**
   * What a finished scan does to the form.
   *
   * The governing rule is that a scan never overwrites something the pilot
   * typed. An empty field is a field they haven't answered, so filling it
   * saves them work; a filled field is an answer, and replacing it with a
   * machine's reading of a photograph is how a pilot loses trust in the
   * feature permanently. Conflicts are surfaced with the scanned value and
   * a one-tap "use it" instead, so nothing the scan read is thrown away —
   * the pilot just stays the one who decides.
   */
  const handleScan = ({ extraction }: ScanOutcome) => {
    const found: ScanConflict[] = [];

    if (extraction.date) {
      if (incurredOn === "") setIncurredOn(extraction.date);
      else if (incurredOn !== extraction.date)
        found.push({ field: "incurred_on", label: "Date", scanned: extraction.date });
    }
    if (extraction.vendor) {
      if (vendor.trim() === "") setVendor(extraction.vendor);
      else if (vendor.trim() !== extraction.vendor)
        found.push({ field: "vendor", label: "Vendor", scanned: extraction.vendor });
    }
    if (extraction.amountCents !== null) {
      const scanned = centsToInput(extraction.amountCents);
      if (amount.trim() === "") setAmount(scanned);
      else if (amount.trim() !== scanned)
        found.push({ field: "amount", label: "Amount", scanned });
    }
    // Category always has a value ("other" by default), so "untouched"
    // rather than "empty" is the test: overwriting a real choice would be
    // wrong, but leaving a receipt that plainly says Signature Flight
    // Support filed as Other would be worse.
    if (extraction.category && !categoryTouched && category === "other") {
      setCategory(extraction.category);
    }

    setConflicts(found);

    // The tail number is the strongest signal a receipt carries about
    // WHICH trip it belongs to, and that association is what decides
    // whether the charge gets rebilled. Only offered when the pilot hasn't
    // already picked a trip.
    if (tripId === NO_TRIP) {
      const match = matchTrip(trips, {
        aircraftIdent: extraction.aircraftIdent,
        date: extraction.date,
      });
      if (match.kind === "one") {
        setTripId(match.trip.id);
        applyTripDefault(match.trip.id);
        setTripHint(match.because);
      } else if (match.kind === "several") {
        setTripHint(match.because);
      }
    }
  };

  const takeConflict = (conflict: ScanConflict) => {
    if (conflict.field === "incurred_on") setIncurredOn(conflict.scanned);
    if (conflict.field === "vendor") setVendor(conflict.scanned);
    if (conflict.field === "amount") setAmount(conflict.scanned);
    setConflicts((current) => current.filter((c) => c.field !== conflict.field));
  };

  // True only while the currently-shown treatment IS the untouched
  // default this trip's client supplied — the visible "why" behind the
  // value, so the pilot isn't surprised by a select that didn't start on
  // "Decide later" and never told them why.
  const defaultedFromClient =
    isNew && !treatmentTouched && selectedTrip?.defaultTreatment === treatment
      ? selectedTrip?.clientName ?? null
      : null;

  return (
    <LCard>
      <form
        action={(formData) => {
          formData.set("trip_id", tripId === NO_TRIP ? "" : tripId);
          // Only ever posted for the trip-less case. A trip means the
          // client is derived and NOT stored, so the field posts blank
          // rather than the name shown in the disabled picker beside it --
          // see clientIdForStorage.
          formData.set("client_id", storedClientId ?? "");
          formData.set("category", category);
          formData.set("treatment", treatment);
          return formAction(formData);
        }}
      >
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

        <p className="mb-1 text-h3 font-bold">The receipt</p>
        <p className="mb-3 text-body-s text-ink-2">
          Attach the photo first and the fields below fill themselves in.
        </p>

        <ReceiptScan
          hasExistingReceipt={Boolean(values.receipt_path)}
          onExtracted={handleScan}
          // Swapping the file makes everything the last scan said describe
          // a different receipt. The values it wrote stay — they may be
          // right, and silently blanking a pilot's form is its own defect —
          // but the explanations attached to them do not.
          onFileChanged={() => {
            setConflicts([]);
            setTripHint(null);
          }}
        />

        {conflicts.length > 0 ? (
          <LAlert tone="warn" className="mt-3">
            <p>
              The scan read these differently from what you have. Yours is kept unless you say
              otherwise.
            </p>
            <div className="mt-2 flex flex-col gap-2">
              {conflicts.map((conflict) => (
                <div key={conflict.field} className="flex flex-wrap items-center gap-3">
                  <span className="text-caption">{`${conflict.label}: ${conflict.scanned}`}</span>
                  <LButton
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => takeConflict(conflict)}
                  >
                    Use this
                  </LButton>
                </div>
              ))}
            </div>
          </LAlert>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <LField label="Date" htmlFor="incurred_on">
            <LInput
              id="incurred_on"
              type="date"
              name="incurred_on"
              required
              value={incurredOn}
              onChange={(event) => setIncurredOn(event.currentTarget.value)}
            />
          </LField>
          <div className="flex flex-col gap-1.5">
            <label id="category-label" className="text-body-s font-medium text-ink">
              Category
            </label>
            <LSelect
              aria-labelledby="category-label"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setCategoryTouched(true);
              }}
            >
              {categories.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </LSelect>
          </div>
          <LField label="Vendor" htmlFor="vendor" hint="Who you paid">
            <LInput
              id="vendor"
              name="vendor"
              value={vendor}
              onChange={(event) => setVendor(event.currentTarget.value)}
            />
          </LField>
          <LField label="Amount (USD)" htmlFor="amount">
            <LInput
              id="amount"
              name="amount"
              required
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.currentTarget.value)}
            />
          </LField>
        </div>

        <div className="mt-6 mb-3">
          <p className="text-h3 font-bold">How it&rsquo;s treated</p>
          <p className="text-body-s text-ink-2">Set once, here. Nothing downstream asks again.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label id="treatment-label" className="text-body-s font-medium text-ink">
              Treatment
            </label>
            <LSelect
              aria-labelledby="treatment-label"
              value={treatment}
              onChange={(event) => handleTreatmentChange(event.target.value)}
            >
              {TREATMENTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </LSelect>
            {defaultedFromClient ? (
              <p className="text-caption text-ink-3">
                {`Defaulted from ${defaultedFromClient}'s billing preference. Change it anytime.`}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <label id="trip-label" className="text-body-s font-medium text-ink">
              Trip
            </label>
            <LSelect
              aria-labelledby="trip-label"
              value={tripId}
              onChange={(event) => handleTripChange(event.target.value)}
            >
              <option value={NO_TRIP}>No trip</option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.label}
                </option>
              ))}
            </LSelect>
            {tripHint ? <p className="text-caption text-ink-3">{tripHint}</p> : null}
            <p className={rebilling ? "text-caption text-warn" : "text-caption text-ink-3"}>
              {trips.length === 0
                ? "No trips yet. Log one first if this expense should be rebilled."
                : rebilling
                  ? "Required. A rebilled expense has to land on an invoice"
                  : "Optional. Leave blank and it waits in the unassigned queue."}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label id="client-label" className="text-body-s font-medium text-ink">
              Client
            </label>
            <LSelect
              aria-labelledby="client-label"
              value={effectiveClientId}
              onChange={(event) => setChosenClientId(event.target.value)}
              disabled={tripDecidesClient}
            >
              <option value={NO_CLIENT}>No client</option>
              {missingClientName ? (
                <option value={effectiveClientId}>{missingClientName}</option>
              ) : null}
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </LSelect>
            <p className="text-caption text-ink-3">
              {tripDecidesClient
                ? selectedTrip?.clientId
                  ? "Set by the trip. Change it on the trip itself."
                  : "That trip has no client, so this stays blank. Give the trip a client to attribute this cost."
                : clients.length === 0
                  ? "No clients yet. Add one to attribute costs you spend on them."
                  : "Optional. Use it for money you spent on a client with no trip, like training they required."}
            </p>
          </div>
          <div className="md:col-span-2">
            <LField label="Notes" htmlFor="notes">
              <LTextarea id="notes" name="notes" rows={2} defaultValue={initial("notes", values.notes)} />
            </LField>
          </div>
        </div>

        <div className="mt-4" role="alert" aria-live="polite">
          {state.error ? <p className="text-caption font-medium text-crit">{state.error}</p> : null}
        </div>

        <div className="mt-4 flex gap-3">
          <LButton type="submit" disabled={pending}>
            {pending ? "Saving…" : submitLabel}
          </LButton>
          <NextLink href="/expenses" className={lButtonClass({ variant: "outline" })}>
            Cancel
          </NextLink>
        </div>
      </form>
    </LCard>
  );
}
