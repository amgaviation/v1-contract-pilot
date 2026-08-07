"use client";

import { useActionState, useEffect, useState } from "react";
import { Button, Card, Flex, Select, Text, TextField } from "@/components/ui";
import { formatCents, formatDate } from "@/lib/format";
import { recordPayment, type InvoiceFormState } from "../actions";

export type PaymentRow = {
  id: string;
  paid_on: string;
  amount_cents: number;
  method: "ach" | "check" | "wire" | "card" | "cash" | "other" | null;
  notes: string | null;
};

// Radix Select forbids an item with value="" — "Unspecified" instead uses
// this sentinel, translated back to "" (the value the `method` FormData
// field must carry for actions.ts's optional() to read it as unset) via
// formData.set("method", …) in the <form action> closure below, rather
// than by renaming the field.
const UNSPECIFIED = "unspecified";
const METHODS = [
  { value: "ach", label: "ACH" },
  { value: "check", label: "Check" },
  { value: "wire", label: "Wire" },
  { value: "card", label: "Card" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];

const initialState: InvoiceFormState = { error: null };

export default function PaymentPanel({
  invoiceId,
  status,
  payments,
}: {
  invoiceId: string;
  status: "draft" | "sent" | "partial" | "paid" | "void";
  payments: PaymentRow[];
}) {
  const [state, formAction, pending] = useActionState(recordPayment, initialState);
  // H5: a rejected payment used to blank amount/notes/date entirely — it
  // never read state.values at all. Echo the submission the same way
  // settings-form.tsx does, falling back to sensible defaults only when
  // there's nothing to echo yet.
  const submitted = state.values;
  const echoed = (key: string, fallback: string) =>
    submitted?.[key] !== undefined ? String(submitted[key]) : fallback;
  const [method, setMethod] = useState(() =>
    submitted?.method !== undefined ? String(submitted.method || UNSPECIFIED) : UNSPECIFIED
  );
  useEffect(() => {
    if (submitted?.method !== undefined) setMethod(String(submitted.method || UNSPECIFIED));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);
  // invoice_payments_validate only accepts a payment against 'sent' or
  // 'partial' — matching that here so the form isn't offered where the
  // database would refuse it (draft has nothing committed to pay yet,
  // paid/void are settled/dead).
  const canRecordPayment = status === "sent" || status === "partial";

  return (
    <Card size="3">
      <Text as="div" size="4" weight="bold" mb="2">
        Payments
      </Text>

      {payments.length === 0 ? (
        <Text color="gray">No payments recorded yet.</Text>
      ) : (
        <Flex direction="column" gap="2" mb={canRecordPayment ? "4" : "0"}>
          {payments.map((payment) => (
            <Flex key={payment.id} justify="between">
              <Text color="gray">
                {formatDate(payment.paid_on)}
                {payment.method ? ` · ${payment.method}` : ""}
              </Text>
              <Text weight="medium" className="tnum">
                {formatCents(payment.amount_cents)}
              </Text>
            </Flex>
          ))}
        </Flex>
      )}

      {canRecordPayment ? (
        <form
          action={(formData) => {
            // Translate the sentinel back to "" before it reaches the
            // FormData field the action reads — the field name (`method`)
            // never changes.
            formData.set("method", method === UNSPECIFIED ? "" : method);
            return formAction(formData);
          }}
        >
          <input type="hidden" name="invoice_id" value={invoiceId} />
          <Flex direction="column" gap="3" mt="3">
            <Text as="label" size="1" color="gray" htmlFor="payment-paid-on">
              Date paid
            </Text>
            <TextField.Root
              id="payment-paid-on"
              type="date"
              name="paid_on"
              defaultValue={echoed("paid_on", new Date().toISOString().slice(0, 10))}
            />
            <Text as="label" size="1" color="gray" htmlFor="payment-amount">
              Amount (USD)
            </Text>
            <TextField.Root
              id="payment-amount"
              name="amount"
              placeholder="Amount (USD)"
              inputMode="decimal"
              defaultValue={echoed("amount", "")}
            />
            <Text as="label" size="1" color="gray" id="payment-method-label">
              Method
            </Text>
            <Select.Root value={method} onValueChange={setMethod}>
              <Select.Trigger placeholder="Method" aria-labelledby="payment-method-label" />
              <Select.Content>
                <Select.Item value={UNSPECIFIED}>Unspecified</Select.Item>
                {METHODS.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <Text as="label" size="1" color="gray" htmlFor="payment-notes">
              Notes
            </Text>
            <TextField.Root id="payment-notes" name="notes" placeholder="Notes" defaultValue={echoed("notes", "")} />
          </Flex>
          <Flex mt="3" role="alert" aria-live="polite">
            {state.error ? (
              <Text size="1" color="red">
                {state.error}
              </Text>
            ) : state.saved ? (
              <Text size="1" color="green">
                Payment recorded.
              </Text>
            ) : null}
          </Flex>
          <Flex mt="3">
            <Button type="submit" disabled={pending} style={{ width: "100%" }}>
              {pending ? "Recording…" : "Record payment"}
            </Button>
          </Flex>
        </form>
      ) : null}
    </Card>
  );
}
