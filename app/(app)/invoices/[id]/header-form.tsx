"use client";

import { useActionState, useEffect, useState } from "react";
import { Button, Card, Flex, Grid, Text, TextField, Select } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { updateInvoiceHeader, updateInvoiceNotes, type InvoiceFormState } from "../actions";

export type ClientOption = { id: string; name: string };

type InvoiceForForm = {
  id: string;
  client_id: string;
  issued_on: string | null;
  due_on: string | null;
  tax_rate_bps: number;
  notes: string | null;
};

const initialState: InvoiceFormState = { error: null };

export default function HeaderForm({
  invoice,
  clients,
  locked,
}: {
  invoice: InvoiceForForm;
  clients: ClientOption[];
  locked: boolean;
}) {
  if (locked) {
    return <LockedHeader invoice={invoice} clients={clients} />;
  }
  return <DraftHeader invoice={invoice} clients={clients} />;
}

function DraftHeader({
  invoice,
  clients,
}: {
  invoice: InvoiceForForm;
  clients: ClientOption[];
}) {
  const [state, formAction, pending] = useActionState(updateInvoiceHeader, initialState);

  // Echoes the submitted values on a validation error — otherwise React 19
  // resets this uncontrolled form to `invoice`'s last-SAVED values on every
  // dispatch, including the error path, and the pilot's edits vanish.
  const submitted = state.values;
  const initial = (key: string, stored: unknown, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  // Radix's Select.Root always renders its posting <select> with
  // `defaultValue`, never `value` (@radix-ui/react-select's
  // SelectBubbleInput) — so it's uncontrolled from React's point of view
  // no matter what Select.Root is given, and it's what the browser
  // actually posts when `name` stays on it. React 19's post-action
  // form.reset() restores it to its mount-time option even on a rejected
  // submit, silently reassigning the invoice to the wrong client. Fixed
  // by dropping `name` and posting the real value from a controlled
  // hidden input instead.
  const [clientId, setClientId] = useState(() => initial("client_id", invoice.client_id));
  useEffect(() => {
    if (submitted?.client_id !== undefined) setClientId(String(submitted.client_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  return (
    <Card size="3">
      <form action={formAction}>
        <input type="hidden" name="id" value={invoice.id} />
        <Text as="div" size="4" weight="bold" mb="3">
          Billing details
        </Text>
        <Grid columns={{ initial: "1", md: "12" }} gap="3">
          <Flex direction="column" gap="1" gridColumn={{ md: "span 6" }}>
            <Text as="label" size="2" weight="medium" id="client-label">
              Client
            </Text>
            <Select.Root value={clientId} onValueChange={setClientId}>
              <Select.Trigger aria-labelledby="client-label" />
              <Select.Content>
                {clients.map((client) => (
                  <Select.Item key={client.id} value={client.id}>
                    {client.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <input type="hidden" name="client_id" value={clientId} />
          </Flex>
          <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
            <Text as="label" size="2" weight="medium" htmlFor="issued_on">
              Issue date
            </Text>
            <TextField.Root
              id="issued_on"
              type="date"
              name="issued_on"
              defaultValue={initial("issued_on", invoice.issued_on)}
            />
            <Text size="1" color="gray">
              Defaults to today when sent
            </Text>
          </Flex>
          <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
            <Text as="label" size="2" weight="medium" htmlFor="due_on">
              Due date
            </Text>
            <TextField.Root
              id="due_on"
              type="date"
              name="due_on"
              defaultValue={initial("due_on", invoice.due_on)}
            />
            <Text size="1" color="gray">
              Defaults from the client&rsquo;s terms
            </Text>
          </Flex>
          <Flex direction="column" gap="1" gridColumn={{ md: "span 4" }}>
            <Text as="label" size="2" weight="medium" htmlFor="tax_rate_percent">
              Tax rate (%)
            </Text>
            <TextField.Root
              id="tax_rate_percent"
              name="tax_rate_percent"
              inputMode="decimal"
              defaultValue={initial(
                "tax_rate_percent",
                (invoice.tax_rate_bps / 100).toString()
              )}
            />
          </Flex>
          <Flex direction="column" gap="1" gridColumn={{ md: "span 8" }}>
            <Text as="label" size="2" weight="medium" htmlFor="notes">
              Notes
            </Text>
            <TextField.Root id="notes" name="notes" defaultValue={initial("notes", invoice.notes)} />
          </Flex>
        </Grid>

        <Flex mt="3" role="alert" aria-live="polite">
          {state.error ? (
            <Text size="1" color="red">
              {state.error}
            </Text>
          ) : state.saved ? (
            <Text size="1" color="green">
              Saved.
            </Text>
          ) : null}
        </Flex>

        <Flex mt="3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save details"}
          </Button>
        </Flex>
      </form>
    </Card>
  );
}

/**
 * Once issued, invoices_protect_issued only lets status/sent_at/
 * delivery_method/notes change at the database — the client/dates/tax
 * fields are shown read-only rather than as disabled inputs, because a
 * disabled control is a UI convention, not enforcement (the actual
 * enforcement is the trigger; this just keeps the screen honest about it).
 */
function LockedHeader({
  invoice,
  clients,
}: {
  invoice: InvoiceForForm;
  clients: ClientOption[];
}) {
  const [state, formAction, pending] = useActionState(updateInvoiceNotes, initialState);
  const clientName = clients.find((c) => c.id === invoice.client_id)?.name ?? "—";

  return (
    <Card size="3">
      <Text as="div" size="4" weight="bold" mb="3">
        Billing details
      </Text>
      <Grid columns={{ initial: "1", md: "12" }} gap="3">
        <Flex direction="column" gap="1" gridColumn={{ md: "span 6" }}>
          <Text size="1" color="gray">
            Client
          </Text>
          <Text weight="medium">{clientName}</Text>
        </Flex>
        <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
          <Text size="1" color="gray">
            Issued
          </Text>
          <Text weight="medium">{formatDate(invoice.issued_on)}</Text>
        </Flex>
        <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
          <Text size="1" color="gray">
            Due
          </Text>
          <Text weight="medium">{formatDate(invoice.due_on)}</Text>
        </Flex>
      </Grid>

      <form action={formAction} style={{ marginTop: "var(--space-3)" }}>
        <input type="hidden" name="id" value={invoice.id} />
        <Flex direction="column" gap="1">
          <Text as="label" size="2" weight="medium" htmlFor="notes-locked">
            Notes
          </Text>
          <TextField.Root id="notes-locked" name="notes" defaultValue={invoice.notes ?? ""} />
          <Text size="1" color="gray">
            This is issued — only notes and delivery status can still change.
          </Text>
        </Flex>
        <Flex mt="2" role="alert" aria-live="polite">
          {state.error ? (
            <Text size="1" color="red">
              {state.error}
            </Text>
          ) : state.saved ? (
            <Text size="1" color="green">
              Saved.
            </Text>
          ) : null}
        </Flex>
        <Flex mt="2">
          <Button type="submit" variant="outline" size="1" disabled={pending}>
            {pending ? "Saving…" : "Save notes"}
          </Button>
        </Flex>
      </form>
    </Card>
  );
}
