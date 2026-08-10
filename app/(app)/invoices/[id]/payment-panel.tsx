"use client";

import { useActionState, useEffect, useState } from "react";
import { Button, Callout, Card, Flex, Select, Separator, Text, TextField } from "@/components/ui";
import { formatCents, formatDate } from "@/lib/format";
import { correctPayment, recordPayment, type InvoiceFormState } from "../actions";
import { createInvoicePaymentLink, type CreateLinkState } from "../payment-link-actions";

export type PaymentRow = {
  id: string;
  paid_on: string;
  /** Negative on a correction row. See reverses_payment_id. */
  amount_cents: number;
  method: "ach" | "check" | "wire" | "card" | "cash" | "other" | null;
  notes: string | null;
  /**
   * Set on a CORRECTION, naming the payment it cancels. The ledger is
   * append-only: a mistyped payment is never edited or deleted, it is
   * negated by a row like this one and both stay on the invoice.
   */
  reverses_payment_id?: string | null;
  reversal_reason?: string | null;
};

/**
 * "That was a typo" — the one thing a pilot could not do until now.
 *
 * Deliberately a disclosure rather than a button that fires on click. A
 * correction is permanent (it cannot itself be corrected) and it changes
 * what an invoice says was paid, so it asks once and takes a reason.
 */
function CorrectPaymentForm({
  invoiceId,
  payment,
  wasCorrected,
}: {
  invoiceId: string;
  payment: PaymentRow;
  /**
   * True once `payments` (refetched via revalidatePath after a successful
   * correction) shows a row naming this one as reversed. The parent used
   * to unmount this component outright the instant that flipped true —
   * but that refetch and this form's OWN useActionState result land in
   * the same render (both are driven by the same server action response),
   * so an unmount here would have deleted a just-arrived LINK_STILL_LIVE_
   * WARNING before the pilot ever saw it. Keep rendering until any notice
   * has been shown and acknowledged.
   */
  wasCorrected: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [state, formAction, pending] = useActionState(correctPayment, initialState);
  const notice = dismissed ? undefined : state.notice;

  useEffect(() => {
    // Close on a clean correction, but NOT when retiring the payment link
    // came back with LINK_STILL_LIVE_WARNING (actions.ts's retirePaymentLink)
    // — that is a task only the pilot can finish on Stripe's own dashboard,
    // and closing the dialog the instant `saved` flips true (the previous
    // bug here) would hide it before it could ever be read.
    if (state.saved && !state.notice) setOpen(false);
  }, [state.saved, state.notice]);

  // The correction has landed and there's nothing left to tell the pilot —
  // the row's own "· corrected" label already covers it.
  if (wasCorrected && !notice) {
    return null;
  }

  if (!open && !notice) {
    return (
      <Button type="button" variant="ghost" size="1" color="gray" onClick={() => setOpen(true)}>
        Correct
      </Button>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <input type="hidden" name="payment_id" value={payment.id} />
      <Flex direction="column" gap="2" mt="2">
        {!wasCorrected ? (
          <>
            <Text size="1" color="gray">
              {`This cancels the ${formatCents(payment.amount_cents)} entry with a matching
                correction — both stay on the invoice, so the record shows what happened.
                Enter the right payment afterwards.`}
            </Text>
            <TextField.Root
              name="reversal_reason"
              placeholder="Why? e.g. typo — meant 450.00"
              aria-label="Why you're correcting this"
            />
            <Flex gap="2">
              <Button type="submit" size="1" disabled={pending}>
                {pending ? "Correcting…" : "Correct it"}
              </Button>
              <Button type="button" size="1" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </Flex>
          </>
        ) : (
          // The correction already landed; this row is only still mounted
          // to show the notice below. "Cancel" would be the wrong word for
          // an action that already happened, so this dismisses instead.
          <Button type="button" size="1" variant="ghost" onClick={() => setDismissed(true)}>
            Dismiss
          </Button>
        )}
        {state.error ? (
          <Text size="1" color="red">
            {state.error}
          </Text>
        ) : null}
        {/* Mirrors recordPayment's own notice rendering below (~line 413)
            — a side effect of a SUCCESSFUL correction, not a failure, so it
            renders separately from `error`. See retirePaymentLink's doc
            comment in actions.ts for what the two possible sentences mean. */}
        {notice ? (
          <Callout.Root color="amber" size="1">
            <Callout.Text>{notice}</Callout.Text>
          </Callout.Root>
        ) : null}
      </Flex>
    </form>
  );
}

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
 *
 * A LINK IS PRICED ONCE, WHEN IT IS GENERATED. Stripe builds a Payment
 * Link from a Price, and that Price snapshots the balance due at that
 * moment. So this panel states what the live link actually charges, and
 * says so plainly when that no longer matches the balance — a $2,000
 * cheque against a $5,000 invoice otherwise leaves a link still asking
 * for $5,000, which the pilot would find out about from their client.
 * recordPayment retires a link whenever a payment lands, so the mismatch
 * should be rare; it is surfaced anyway, because "rare" is not
 * "impossible" and the cost of missing it lands on someone else.
 */
function PayOnlinePanel({
  invoiceId,
  connected,
  existingLinkUrl,
  existingLinkAmountCents,
  balanceDueCents,
}: {
  invoiceId: string;
  connected: boolean;
  existingLinkUrl: string | null;
  existingLinkAmountCents: number | null;
  balanceDueCents: number | null;
}) {
  const [state, formAction, pending] = useActionState(createInvoicePaymentLink, initialLinkState);
  // A link generated in this render is priced at the current balance by
  // construction — only one loaded from the server can be stale.
  const justCreated = Boolean(state.url);
  const url = state.url ?? existingLinkUrl;
  const linkAmountCents = justCreated ? balanceDueCents : existingLinkAmountCents;
  // A null existingLinkAmountCents is a link generated before this column
  // existed (20260810010000) and never regenerated — there's no way to know
  // what it actually charges without a Stripe round trip this panel doesn't
  // make. app/invoice/[token]/page.tsx's `linkCurrent` treats that same
  // null identically to a mismatched amount, not as "unknown, so assume
  // fine" — this has to agree, or the client reads "out of date, contact
  // your pilot" while the pilot's own screen says nothing is wrong.
  const stale =
    !justCreated &&
    url !== null &&
    balanceDueCents !== null &&
    (existingLinkAmountCents === null || existingLinkAmountCents !== balanceDueCents);

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
            {linkAmountCents !== null
              ? `Send this link to your client to pay ${formatCents(linkAmountCents)} by card:`
              : "Send this link to your client to pay by card:"}
          </Text>
          <TextField.Root readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <Text size="1" color="gray">
            It can only be paid once — Stripe switches it off after the first
            payment goes through. Generating a new link switches this one off
            too.
          </Text>
        </Flex>
      ) : null}
      {stale && balanceDueCents !== null ? (
        <Callout.Root color="amber" size="1">
          <Callout.Text>
            {existingLinkAmountCents !== null
              ? `This link still charges ${formatCents(existingLinkAmountCents)}, but the balance due is now ${formatCents(balanceDueCents)}. Generate a new link before you send it.`
              : "This link predates this app tracking what it charges, so there's no way to confirm it still matches the balance due. Generate a new link before you send it."}
          </Callout.Text>
        </Callout.Root>
      ) : null}
      <form action={formAction}>
        <input type="hidden" name="invoice_id" value={invoiceId} />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Creating…" : url ? "Generate a new link" : "Generate payment link"}
        </Button>
      </form>
      <Flex direction="column" gap="2" role="alert" aria-live="polite">
        {state.error ? (
          <Text size="1" color="red">
            {state.error}
          </Text>
        ) : null}
        {state.warning ? (
          <Callout.Root color="amber" size="1">
            <Callout.Text>{state.warning}</Callout.Text>
          </Callout.Root>
        ) : null}
      </Flex>
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
  existingPaymentLinkAmountCents,
  balanceDueCents,
}: {
  invoiceId: string;
  status: "draft" | "sent" | "partial" | "paid" | "void";
  payments: PaymentRow[];
  connectAccountConnected: boolean;
  existingPaymentLinkUrl: string | null;
  existingPaymentLinkAmountCents: number | null;
  balanceDueCents: number | null;
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
  // Which payments already carry a correction. Built from the rows
  // themselves rather than fetched — the correction names its target, so
  // the answer is already on this screen.
  const corrected = new Set(
    payments.map((p) => p.reverses_payment_id).filter((id): id is string => Boolean(id))
  );

  return (
    <Card size="3">
      <Text as="div" size="4" weight="bold" mb="2">
        Payments
      </Text>

      {payments.length === 0 ? (
        <Text color="gray">No payments recorded yet.</Text>
      ) : (
        <Flex direction="column" gap="3" mb={canRecordPayment ? "4" : "0"}>
          {payments.map((payment) => {
            const isCorrection = Boolean(payment.reverses_payment_id);
            // A payment that has already been cancelled keeps its row —
            // that is the point of an append-only ledger — but it must not
            // offer to be cancelled again, and it should read as settled
            // rather than as money outstanding.
            const wasCorrected = corrected.has(payment.id);
            return (
              <Flex key={payment.id} direction="column">
                <Flex justify="between" align="center" gap="3">
                  <Text color="gray">
                    {formatDate(payment.paid_on)}
                    {payment.method ? ` · ${METHOD_LABEL[payment.method] ?? payment.method}` : ""}
                    {isCorrection ? " · correction" : ""}
                    {wasCorrected ? " · corrected" : ""}
                  </Text>
                  <Flex align="center" gap="2">
                    <Text
                      weight="medium"
                      className="tnum"
                      color={isCorrection || wasCorrected ? "gray" : undefined}
                    >
                      {formatCents(payment.amount_cents)}
                    </Text>
                    {!isCorrection ? (
                      <CorrectPaymentForm
                        invoiceId={invoiceId}
                        payment={payment}
                        wasCorrected={wasCorrected}
                      />
                    ) : null}
                  </Flex>
                </Flex>
                {payment.reversal_reason ? (
                  <Text size="1" color="gray">
                    {payment.reversal_reason}
                  </Text>
                ) : null}
              </Flex>
            );
          })}
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
            existingLinkAmountCents={existingPaymentLinkAmountCents}
            balanceDueCents={balanceDueCents}
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
          <Flex mt="3" direction="column" gap="2" role="alert" aria-live="polite">
            {state.error ? (
              <Text size="1" color="red">
                {state.error}
              </Text>
            ) : state.saved ? (
              <Text size="1" color="green">
                Payment recorded.
              </Text>
            ) : null}
            {/* A side effect of a SUCCESSFUL record, not a failure:
                recording a payment retires the online payment link, because
                that link is priced at the balance it was generated for.
                Rendered separately from `error` so a green "Payment
                recorded." and this can both be true at once, which they
                usually are. */}
            {state.notice ? (
              <Callout.Root color="amber" size="1">
                <Callout.Text>{state.notice}</Callout.Text>
              </Callout.Root>
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
