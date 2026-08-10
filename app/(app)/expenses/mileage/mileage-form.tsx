"use client";

import { useActionState, useState, useTransition } from "react";
import NextLink from "next/link";
import {
  AlertDialog,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Link as RadixLink,
  Select,
  Table,
  Text,
  TextArea,
  TextField,
} from "@/components/ui";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { formatCents, formatDate } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";
import {
  createMileageEntry,
  updateMileageEntry,
  deleteMileageEntry,
  type MileageFormState,
} from "./actions";

type MileageEntryRow = Database["pilot"]["Tables"]["mileage_entries"]["Row"];

export type TripOption = { id: string; label: string };
export type ClientOption = { id: string; name: string };

/** Rates the pilot has recorded (Settings → Mileage), keyed by tax year. */
export type RatesByYear = Record<number, number>;

// Radix Select forbids value="" — these sentinels stand in for "none" and
// are translated back to "" on submit, same pattern as expense-form.tsx.
const NO_TRIP = "none";
const NO_CLIENT = "none";

const initialState: MileageFormState = { error: null };

function yearOf(dateStr: string): number | null {
  const y = Number(dateStr.slice(0, 4));
  return Number.isInteger(y) ? y : null;
}

/** cents-per-mile → a compact display string, trailing zeros trimmed. */
function formatRateForDisplay(rate: number): string {
  return rate.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Shared field set for both the add form and an in-place row edit. Not
 * exported — this file is the one interactive surface the mileage screen
 * gets (page.tsx and actions.ts are server-only), so the add form and the
 * per-row edit form share their markup here instead of duplicating it.
 */
function EntryFields({
  idPrefix,
  values,
  trips,
  clients,
  rates,
  disabled,
  rateLocked,
}: {
  idPrefix: string;
  values: {
    drove_on: string;
    miles: string;
    from_place: string;
    to_place: string;
    purpose: string;
    trip_id: string;
    client_id: string;
    rate_cents_per_mile: string;
    notes: string;
  };
  trips: TripOption[];
  clients: ClientOption[];
  rates: RatesByYear;
  disabled?: boolean;
  /**
   * True when editing an already-saved entry. The rate is snapshotted at
   * capture and, as of 20260809050000, genuinely immutable — the database
   * has no UPDATE grant on mileage_entries.rate_cents_per_mile for
   * `authenticated` at all. This renders the rate as read-only display
   * text with NO `name` attribute, so it is never submitted on an edit
   * (an update payload including it would be rejected with a permission
   * error rather than silently accepted). Correcting a wrong rate is
   * delete-and-recreate, the same discipline
   * recurring_invoice_schedules.client_id/cadence/anchor_date uses.
   */
  rateLocked?: boolean;
}) {
  const [droveOn, setDroveOn] = useState(values.drove_on);
  const [tripId, setTripId] = useState(values.trip_id === "" ? NO_TRIP : values.trip_id);
  const [clientId, setClientId] = useState(values.client_id === "" ? NO_CLIENT : values.client_id);
  const [rate, setRate] = useState(values.rate_cents_per_mile);

  const year = yearOf(droveOn);
  const yearRate = year !== null ? rates[year] : undefined;

  return (
    <Grid columns={{ initial: "1", md: "4" }} gap="3">
      <input type="hidden" name="trip_id" value={tripId === NO_TRIP ? "" : tripId} />
      <input type="hidden" name="client_id" value={clientId === NO_CLIENT ? "" : clientId} />

      <Flex direction="column" gap="1">
        <Text as="label" size="2" weight="medium" htmlFor={`${idPrefix}-drove_on`}>
          Date
        </Text>
        <TextField.Root
          id={`${idPrefix}-drove_on`}
          type="date"
          name="drove_on"
          required
          disabled={disabled}
          value={droveOn}
          onChange={(e) => setDroveOn(e.target.value)}
        />
      </Flex>
      <Flex direction="column" gap="1">
        <Text as="label" size="2" weight="medium" htmlFor={`${idPrefix}-miles`}>
          Miles
        </Text>
        <TextField.Root
          id={`${idPrefix}-miles`}
          name="miles"
          required
          inputMode="decimal"
          disabled={disabled}
          defaultValue={values.miles}
        />
      </Flex>
      <Flex direction="column" gap="1">
        <Text as="label" size="2" weight="medium" htmlFor={`${idPrefix}-from`}>
          From
        </Text>
        <TextField.Root
          id={`${idPrefix}-from`}
          name="from_place"
          required
          placeholder="home"
          disabled={disabled}
          defaultValue={values.from_place}
        />
      </Flex>
      <Flex direction="column" gap="1">
        <Text as="label" size="2" weight="medium" htmlFor={`${idPrefix}-to`}>
          To
        </Text>
        <TextField.Root
          id={`${idPrefix}-to`}
          name="to_place"
          required
          placeholder="KTEB"
          disabled={disabled}
          defaultValue={values.to_place}
        />
      </Flex>

      <Box style={{ gridColumn: "1 / -1" }}>
        <Flex direction="column" gap="1">
          <Text as="label" size="2" weight="medium" htmlFor={`${idPrefix}-purpose`}>
            Purpose
          </Text>
          <TextField.Root
            id={`${idPrefix}-purpose`}
            name="purpose"
            required
            placeholder="e.g. Drive to sim training, maintenance drop-off, FBO pickup"
            disabled={disabled}
            defaultValue={values.purpose}
          />
          <Text size="1" color="gray">
            What the drive was for. This is the record that lets you (or your tax preparer) tell
            business driving from ordinary commuting later — this product does not decide that
            for you.
          </Text>
        </Flex>
      </Box>

      <Flex direction="column" gap="1">
        <Text as="label" size="2" weight="medium" id={`${idPrefix}-trip-label`}>
          Trip
        </Text>
        <Select.Root value={tripId} onValueChange={setTripId} disabled={disabled}>
          <Select.Trigger aria-labelledby={`${idPrefix}-trip-label`} />
          <Select.Content>
            <Select.Item value={NO_TRIP}>No trip</Select.Item>
            {trips.map((trip) => (
              <Select.Item key={trip.id} value={trip.id}>
                {trip.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>
      <Flex direction="column" gap="1">
        <Text as="label" size="2" weight="medium" id={`${idPrefix}-client-label`}>
          Client
        </Text>
        <Select.Root value={clientId} onValueChange={setClientId} disabled={disabled}>
          <Select.Trigger aria-labelledby={`${idPrefix}-client-label`} />
          <Select.Content>
            <Select.Item value={NO_CLIENT}>No client</Select.Item>
            {clients.map((client) => (
              <Select.Item key={client.id} value={client.id}>
                {client.name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>
      <Flex direction="column" gap="1">
        <Text as="label" size="2" weight="medium" htmlFor={`${idPrefix}-rate`}>
          Rate (cents/mile)
        </Text>
        {rateLocked ? (
          <>
            <TextField.Root
              id={`${idPrefix}-rate`}
              // NO name — never submitted. Locked once saved; see
              // EntryFields' rateLocked doc comment.
              value={values.rate_cents_per_mile}
              readOnly
              disabled
              className="tnum"
            />
            <Text size="1" color="gray">
              Locked once saved, so a later rate change can never restate a
              drive already recorded. To fix a wrong rate, delete this drive
              and log it again.
            </Text>
          </>
        ) : (
          <>
            <TextField.Root
              id={`${idPrefix}-rate`}
              name="rate_cents_per_mile"
              required
              inputMode="decimal"
              disabled={disabled}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
            {yearRate !== undefined ? (
              <Button
                type="button"
                variant="ghost"
                size="1"
                disabled={disabled}
                onClick={() => setRate(formatRateForDisplay(yearRate))}
              >
                Use {year}&rsquo;s rate ({formatRateForDisplay(yearRate)}¢/mi)
              </Button>
            ) : (
              <Text size="1" color="amber">
                {year ? `No rate on file for ${year}. ` : ""}
                <RadixLink asChild>
                  <NextLink href="/settings?tab=mileage">Add it in Settings</NextLink>
                </RadixLink>
                , or enter it manually.
              </Text>
            )}
          </>
        )}
      </Flex>
      <Box style={{ gridColumn: "span 2" }}>
        <Flex direction="column" gap="1">
          <Text as="label" size="2" weight="medium" htmlFor={`${idPrefix}-notes`}>
            Notes
          </Text>
          <TextArea
            id={`${idPrefix}-notes`}
            name="notes"
            rows={1}
            disabled={disabled}
            defaultValue={values.notes}
          />
        </Flex>
      </Box>
    </Grid>
  );
}

function emptyValues(preselectedTripId?: string) {
  return {
    drove_on: "",
    miles: "",
    from_place: "",
    to_place: "",
    purpose: "",
    trip_id: preselectedTripId ?? "",
    client_id: "",
    rate_cents_per_mile: "",
    notes: "",
  };
}

function rowValues(entry: MileageEntryRow) {
  return {
    drove_on: entry.drove_on,
    miles: String(entry.miles),
    from_place: entry.from_place,
    to_place: entry.to_place,
    purpose: entry.purpose,
    trip_id: entry.trip_id ?? "",
    client_id: entry.client_id ?? "",
    rate_cents_per_mile: formatRateForDisplay(entry.rate_cents_per_mile),
    notes: entry.notes ?? "",
  };
}

function AddEntryCard({
  trips,
  clients,
  rates,
}: {
  trips: TripOption[];
  clients: ClientOption[];
  rates: RatesByYear;
}) {
  const [state, formAction, pending] = useActionState(createMileageEntry, initialState);
  // React 19 resets an uncontrolled form on every dispatch, error path
  // included — a rejected submit would otherwise blank a form the pilot
  // just carefully filled in. Re-mounting the field block from the echoed
  // values (via `key`) is simpler here than threading each value through
  // `initial()` the way expense-form.tsx does, because EntryFields already
  // owns its own local state for the fields React would otherwise reset.
  const submitted = state.values;
  const values = submitted
    ? {
        drove_on: submitted.drove_on ?? "",
        miles: submitted.miles ?? "",
        from_place: submitted.from_place ?? "",
        to_place: submitted.to_place ?? "",
        purpose: submitted.purpose ?? "",
        trip_id: submitted.trip_id ?? "",
        client_id: submitted.client_id ?? "",
        rate_cents_per_mile: submitted.rate_cents_per_mile ?? "",
        notes: submitted.notes ?? "",
      }
    : emptyValues();

  return (
    <Card size="3">
      <form action={formAction}>
        <Text as="div" size="4" weight="bold" mb="3">
          Log a drive
        </Text>
        <EntryFields
          // Forces a remount whenever the echoed values change (a failed
          // submit). React calls the native form.reset() after EVERY action
          // dispatch, error path included — that wipes every uncontrolled
          // (defaultValue-based) field here (miles/from/to/purpose/notes)
          // back to its ORIGINAL mount value unless the field itself
          // remounts with the echoed value as its new default. Re-keying is
          // simpler than threading every field through the `initial()`
          // pattern expense-form.tsx uses, because EntryFields' own
          // useState hooks need to reinitialize too (droveOn/tripId/
          // clientId/rate), not just its defaultValue props.
          key={JSON.stringify(values)}
          idPrefix="add"
          values={values}
          trips={trips}
          clients={clients}
          rates={rates}
        />
        <Flex mt="3" role="alert" aria-live="polite">
          {state.error ? (
            <Text size="1" color="red">
              {state.error}
            </Text>
          ) : null}
        </Flex>
        <Flex mt="3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Add drive"}
          </Button>
        </Flex>
      </form>
    </Card>
  );
}

function EntryRow({
  entry,
  trips,
  clients,
  rates,
  editing,
  onEdit,
  onDone,
}: {
  entry: MileageEntryRow;
  trips: TripOption[];
  clients: ClientOption[];
  rates: RatesByYear;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateMileageEntry, initialState);
  const [deleting, startDelete] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const submitted = state.values;
  const values = submitted
    ? {
        drove_on: submitted.drove_on ?? "",
        miles: submitted.miles ?? "",
        from_place: submitted.from_place ?? "",
        to_place: submitted.to_place ?? "",
        purpose: submitted.purpose ?? "",
        trip_id: submitted.trip_id ?? "",
        client_id: submitted.client_id ?? "",
        rate_cents_per_mile: submitted.rate_cents_per_mile ?? "",
        notes: submitted.notes ?? "",
      }
    : rowValues(entry);

  const tripLabel = entry.trip_id ? trips.find((t) => t.id === entry.trip_id)?.label : null;
  const clientLabel = entry.client_id ? clients.find((c) => c.id === entry.client_id)?.name : null;

  function handleDelete() {
    startDelete(async () => {
      setDeleteError(null);
      const result = await deleteMileageEntry(entry.id);
      if (result.error) setDeleteError(result.error);
      else setConfirmOpen(false);
    });
  }

  if (!editing) {
    return (
      <Table.Row>
        <Table.RowHeaderCell>
          <Text weight="medium">{formatDate(entry.drove_on)}</Text>
        </Table.RowHeaderCell>
        <Table.Cell>
          <Text className="tnum">{entry.miles}</Text>
        </Table.Cell>
        <Table.Cell>
          <Text color="gray">
            {entry.from_place} → {entry.to_place}
          </Text>
        </Table.Cell>
        <Table.Cell>
          <Text color="gray">{entry.purpose}</Text>
        </Table.Cell>
        <Table.Cell>
          <Text color="gray">
            {tripLabel ?? clientLabel ?? "—"}
          </Text>
        </Table.Cell>
        <Table.Cell justify="end">
          <Text weight="medium" className="tnum">
            {formatCents(entry.amount_cents)}
          </Text>
        </Table.Cell>
        <Table.Cell>
          <Flex gap="2">
            <Button type="button" size="1" variant="soft" onClick={onEdit}>
              Edit
            </Button>
            <AlertDialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
              <AlertDialog.Trigger>
                <Button type="button" size="1" variant="ghost" color="red">
                  Delete
                </Button>
              </AlertDialog.Trigger>
              <AlertDialog.Content maxWidth="420px">
                <AlertDialog.Title>Delete this drive?</AlertDialog.Title>
                <AlertDialog.Description size="2">
                  {formatDate(entry.drove_on)} — {entry.from_place} to {entry.to_place} (
                  {entry.miles} mi). This can&rsquo;t be undone.
                </AlertDialog.Description>
                {deleteError ? (
                  <Box mt="2">
                    <Text size="1" color="red" role="alert">
                      {deleteError}
                    </Text>
                  </Box>
                ) : null}
                <Flex gap="3" mt="4" justify="end">
                  <AlertDialog.Cancel>
                    <Button variant="soft" color="gray" disabled={deleting}>
                      Cancel
                    </Button>
                  </AlertDialog.Cancel>
                  <Button variant="solid" color="red" disabled={deleting} onClick={handleDelete}>
                    {deleting ? "Deleting…" : "Delete"}
                  </Button>
                </Flex>
              </AlertDialog.Content>
            </AlertDialog.Root>
          </Flex>
        </Table.Cell>
      </Table.Row>
    );
  }

  return (
    <Table.Row>
      <Table.Cell colSpan={7}>
        <form
          action={(formData) => {
            formData.set("id", entry.id);
            return formAction(formData);
          }}
        >
          <input type="hidden" name="id" value={entry.id} />
          <EntryFields
            // See AddEntryCard's identical comment: remount on every echo
            // so the uncontrolled fields pick up the rejected submit's
            // values instead of reverting to the row's original data.
            key={JSON.stringify(values)}
            idPrefix={`edit-${entry.id}`}
            values={values}
            trips={trips}
            clients={clients}
            rates={rates}
            rateLocked
          />
          <Flex mt="2" role="alert" aria-live="polite">
            {state.error ? (
              <Text size="1" color="red">
                {state.error}
              </Text>
            ) : null}
          </Flex>
          <Flex mt="3" gap="2">
            <Button type="submit" size="1" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" size="1" variant="outline" onClick={onDone}>
              Cancel
            </Button>
          </Flex>
        </form>
      </Table.Cell>
    </Table.Row>
  );
}

export default function MileageForm({
  entries,
  trips,
  clients,
  rates,
}: {
  entries: MileageEntryRow[];
  trips: TripOption[];
  clients: ClientOption[];
  rates: RatesByYear;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <Flex direction="column" gap="4">
      <Callout.Root color="blue">
        <Callout.Icon>
          <InfoCircledIcon />
        </Callout.Icon>
        <Callout.Text>
          <Text as="div" size="2">
            This is a record of drives, not a determination of what&rsquo;s deductible. Commuting
            between home and a regular place of work generally isn&rsquo;t — whether a given drive
            counts turns on facts about your situation this product can&rsquo;t see. The standard
            mileage rate and actual vehicle expenses (tracked as fuel/rental-car expenses) are
            alternatives, not additive — using both for the same vehicle in the same year can
            double-count. Confirm your method and your deductions with a tax professional.
          </Text>
        </Callout.Text>
      </Callout.Root>

      <AddEntryCard trips={trips} clients={clients} rates={rates} />

      <Card size="3">
        {entries.length === 0 ? (
          <Flex direction="column" align="center" gap="2" py="6">
            <Text size="4" weight="bold">
              No drives logged yet
            </Text>
            <Text size="2" color="gray" align="center">
              Log a drive above — date, miles, and what it was for.
            </Text>
          </Flex>
        ) : (
          <Table.Root variant="ghost">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Miles</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Route</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Purpose</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Trip / client</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Amount</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {entries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  trips={trips}
                  clients={clients}
                  rates={rates}
                  editing={editingId === entry.id}
                  onEdit={() => setEditingId(entry.id)}
                  onDone={() => setEditingId(null)}
                />
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </Card>
    </Flex>
  );
}
