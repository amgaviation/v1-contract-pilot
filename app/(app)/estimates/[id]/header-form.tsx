"use client";

import { useActionState, useEffect, useState } from "react";
import { Button, Card, Flex, Grid, Select, Text, TextArea, TextField } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { updateEstimateHeader, updateEstimateNotes, type EstimateFormState } from "../actions";

export type ClientOption = { id: string; name: string };

type EstimateForForm = {
  id: string;
  client_id: string;
  issued_on: string | null;
  valid_until: string | null;
  tax_rate_bps: number;
  terms: string | null;
  notes: string | null;
};

const initialState: EstimateFormState = { error: null };

export default function HeaderForm({
  estimate,
  clients,
  locked,
}: {
  estimate: EstimateForForm;
  clients: ClientOption[];
  locked: boolean;
}) {
  if (locked) {
    return <LockedHeader estimate={estimate} clients={clients} />;
  }
  return <DraftHeader estimate={estimate} clients={clients} />;
}

function DraftHeader({
  estimate,
  clients,
}: {
  estimate: EstimateForForm;
  clients: ClientOption[];
}) {
  const [state, formAction, pending] = useActionState(updateEstimateHeader, initialState);

  // Echoes the submitted values on a validation error — otherwise React 19
  // resets this uncontrolled form to the estimate's last-SAVED values on
  // every dispatch, including the error path, and the pilot's edits vanish
  // (same pattern as the invoice header form).
  const submitted = state.values;
  const initial = (key: string, stored: unknown, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  // Radix's Select.Root posts through an uncontrolled bubble <select> that
  // React 19's post-action reset restores to its mount-time option even on
  // a rejected submit — same fix as every other Select in this product:
  // drop `name`, post the real value from a controlled hidden input.
  const [clientId, setClientId] = useState(() => initial("client_id", estimate.client_id));
  useEffect(() => {
    if (submitted?.client_id !== undefined) setClientId(String(submitted.client_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  return (
    <Card size="3">
      <form action={formAction}>
        <input type="hidden" name="id" value={estimate.id} />
        <Text as="div" size="4" weight="bold" mb="3">
          Quote details
        </Text>
        <Grid columns={{ initial: "1", md: "12" }} gap="3">
          <Flex direction="column" gap="1" gridColumn={{ md: "span 6" }}>
            <Text as="label" size="2" weight="medium" id="estimate-client-label">
              Client
            </Text>
            <Select.Root value={clientId} onValueChange={setClientId}>
              <Select.Trigger aria-labelledby="estimate-client-label" />
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
            <Text as="label" size="2" weight="medium" htmlFor="valid_until">
              Valid until
            </Text>
            <TextField.Root
              id="valid_until"
              type="date"
              name="valid_until"
              defaultValue={initial("valid_until", estimate.valid_until)}
            />
            <Text size="1" color="gray">
              How long the quote stands
            </Text>
          </Flex>
          <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
            <Text as="label" size="2" weight="medium" htmlFor="tax_rate_percent">
              Tax rate (%)
            </Text>
            <TextField.Root
              id="tax_rate_percent"
              name="tax_rate_percent"
              inputMode="decimal"
              defaultValue={initial(
                "tax_rate_percent",
                (estimate.tax_rate_bps / 100).toString()
              )}
            />
          </Flex>
          <Flex direction="column" gap="1" gridColumn={{ md: "span 6" }}>
            <Text as="label" size="2" weight="medium" htmlFor="terms">
              Terms
            </Text>
            <TextArea
              id="terms"
              name="terms"
              rows={3}
              defaultValue={initial("terms", estimate.terms)}
              placeholder="Cancellation terms, per-diem basis, what's not included…"
            />
          </Flex>
          <Flex direction="column" gap="1" gridColumn={{ md: "span 6" }}>
            <Text as="label" size="2" weight="medium" htmlFor="notes">
              Notes
            </Text>
            <TextArea id="notes" name="notes" rows={3} defaultValue={initial("notes", estimate.notes)} />
            <Text size="1" color="gray">
              Carried onto the invoice if this estimate converts
            </Text>
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
 * Once out of draft, the screen stops offering edits to what the client
 * was quoted — the way to change a sent estimate is "Revise" (back to
 * draft, edit, re-send), so what the client saw and what the pilot edited
 * never silently diverge. Notes stay editable in any status: they're the
 * pilot's own margin, not part of the quote. The database is looser here
 * on purpose (estimates_protect allows more than this form offers); this
 * is a UI discipline, not the enforcement.
 */
function LockedHeader({
  estimate,
  clients,
}: {
  estimate: EstimateForForm;
  clients: ClientOption[];
}) {
  const [state, formAction, pending] = useActionState(updateEstimateNotes, initialState);
  const clientName = clients.find((c) => c.id === estimate.client_id)?.name ?? "—";

  return (
    <Card size="3">
      <Text as="div" size="4" weight="bold" mb="3">
        Quote details
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
            Sent
          </Text>
          <Text weight="medium">{formatDate(estimate.issued_on)}</Text>
        </Flex>
        <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
          <Text size="1" color="gray">
            Valid until
          </Text>
          <Text weight="medium">{formatDate(estimate.valid_until)}</Text>
        </Flex>
        <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
          <Text size="1" color="gray">
            Tax rate
          </Text>
          <Text weight="medium" className="tnum">
            {(estimate.tax_rate_bps / 100).toString()}%
          </Text>
        </Flex>
        <Flex direction="column" gap="1" gridColumn={{ md: "span 9" }}>
          <Text size="1" color="gray">
            Terms
          </Text>
          <Text weight="medium">{estimate.terms || "—"}</Text>
        </Flex>
      </Grid>

      <form action={formAction} style={{ marginTop: "var(--space-3)" }}>
        <input type="hidden" name="id" value={estimate.id} />
        <Flex direction="column" gap="1">
          <Text as="label" size="2" weight="medium" htmlFor="notes-locked">
            Notes
          </Text>
          <TextArea id="notes-locked" name="notes" rows={2} defaultValue={estimate.notes ?? ""} />
          <Text size="1" color="gray">
            This estimate is out of draft — revise it to change what the client
            sees. Notes are yours and stay editable.
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
