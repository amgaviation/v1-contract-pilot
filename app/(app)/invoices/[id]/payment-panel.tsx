"use client";

import { useActionState, useEffect, useState } from "react";
import { Button, Card, Flex, Select, Separator, Text, TextField } from "@/components/ui";
import { formatCents, formatDate } from "@/lib/format";
import { recordPayment, type InvoiceFormState } from "../actions";
import { createInvoicePaymentLink, type CreateLinkState } from "../payment-link-actions";

export type PaymentRow = {
  id: string;
  paid_on: string;
  amount_cents: number;
  method: "ach" | "check" | "wire" | "card" | "cash" | "other" | null;
  notes: string | null;
};

const initialLinkState: CreateLinkState = { error: null };

/**
 * "Pay online" — Stripe Connect (Standard), payment-link-only (docs/
 * PLAN.md decision #8). See
 * supabase/migrations/20260809040000_connect_payments.sql's header for
 * the full (a)-vs-(b) reasoning; the short version: auto-recording a
 * client's payment would need a Connect webhook writing tenant financial
 * data through a request with no session, which is exactly the kind of
 * second privileged entry point lib/supabase/service-role.ts's own header
 * says must not exist beyond the platform billing webhook. So this button
 * only ever CREATES a Stripe-hosted Payment Link (a direct charge on the
 * pilot's own connected account, no application fee, no funds routed
 * through this platform) — when the client pays, the pilot sees it land
 * in their own Stripe Dashboard and records it below exactly as they
 * would a cheque or a wire. That manual last step is a documented,
 * deliberate gap, not an oversight.
 */
function PayOnlinePanel({
  invoiceId,
  connected,
  existingLinkUrl,
}: {
  invoiceId: string;
  connected: boolean;
  existingLinkUrl: string | null;
}) {
  const [state, formAction, pending] = useActionState(createInvoicePaymentLink, initialLinkState);
  const url = state.url ?? existingLinkUrl;

  if (!connected) {
    return (
      <Text size="1" color="gray">
        Connect Stripe from Settings to accept card payments online.
      </Text>
    );
  }

  return (
    <Flex direction="column" gap="2" align="start">
      {url ? (
        <Flex direction="column" gap="1" width="100%">
          <Text size="1" color="gray">
            Send this link to your client to pay by card:
          </Text>
          <TextField.Root readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        </Flex>
      ) : null}
      <form action={formAction}>
        <input type="hidden" name="invoice_id" value={invoiceId} />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Creating…" : url ? "Generate a new link" : "Generate payment link"}
        </Button>
      </form>
      {state.error ? (
        <Text size="1" color="red">
          {state.error}
        </Text>
      ) : null}
    </Flex>
  );
}

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

const METHOD_LABEL: Record<string, string> = Object.fromEntries(
  METHODS.map((m) => [m.value, m.label])
);

const initialState: InvoiceFormState = { error: null };

/**
 * Today as "YYYY-MM-DD" in the PILOT'S OWN local calendar, not
 * `new Date().toISOString().slice(0, 10)` — toISOString() converts to UTC
 * first, so a pilot west of UTC recording a payment in the evening (e.g.
 * 5pm Pacific) gets TOMORROW's date pre-filled on a money record. This is
 * a client component, so the browser's local clock/timezone is available;
 * lib/format.ts's "a date is a calendar fact, not an instant" rule applies
 * here too — the default has to match the calendar the pilot is standing
 * in, not an instant translated through UTC.
 */
function todayLocalIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function PaymentPanel({
  invoiceId,
  status,
  payments,
  connectAccountConnected,
  existingPaymentLinkUrl,
}: {
  invoiceId: string;
  status: "draft" | "sent" | "partial" | "paid" | "void";
  payments: PaymentRow[];
  connectAccountConnected: boolean;
  existingPaymentLinkUrl: string | null;
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
                {payment.method ? ` · ${METHOD_LABEL[payment.method] ?? payment.method}` : ""}
              </Text>
              <Text weight="medium" className="tnum">
                {formatCents(payment.amount_cents)}
              </Text>
            </Flex>
          ))}
        </Flex>
      )}

      {canRecordPayment ? (
        <>
          <Separator size="4" my="3" />
          <Text as="div" size="2" weight="medium" mb="2">
            Pay online
          </Text>
          <PayOnlinePanel
            invoiceId={invoiceId}
            connected={connectAccountConnected}
            existingLinkUrl={existingPaymentLinkUrl}
          />
          <Separator size="4" my="3" />
        </>
      ) : null}

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
              defaultValue={echoed("paid_on", todayLocalIso())}
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
