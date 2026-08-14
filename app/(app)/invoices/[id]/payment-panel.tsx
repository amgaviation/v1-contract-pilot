"use client";

import { useActionState, useEffect, useState } from "react";
import { Button, Callout, Card, Flex, Select, Separator, Text, TextField } from "@/components/ui";
import { formatCents, formatDate } from "@/lib/format";
import {
  BANK_PAYMENT_FEE_NOTE,
  PAYMENT_METHOD_CHOICES,
  type PaymentMethodChoice,
} from "@/lib/stripe/payment-methods";
import { correctPayment, recordPayment, type InvoiceFormState } from "../actions";
import {
  createInvoicePaymentLink,
  markConnectNoticeReviewed,
  type CreateLinkState,
  type ReviewNoticeState,
} from "../payment-link-actions";

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
  /**
   * Who put this row here (20260813100000). 'stripe_link' means the
   * Connect webhook recorded it when the client paid this invoice's
   * payment link; 'manual' means a pilot typed it. Rendered, not just
   * stored: a pilot who cannot tell the two apart at a glance is a pilot
   * who records the same money twice, which is the whole reason the
   * column exists rather than a note appended to `notes`.
   */
  source?: "manual" | "stripe_link" | null;
};

/**
 * One unresolved pilot.stripe_connect_events row — something that happened
 * to this invoice on Stripe and did NOT become a payment row.
 *
 * FOUR outcomes reach here (page.tsx's query says which and why), and they
 * fall into two groups that must not look alike:
 *
 *   MONEY ARRIVED AND WE DID NOT RECORD IT — 'needs_review' (it looked as
 *   though the pilot had already entered it by hand) and 'refused' (the
 *   invoice or the session could not take it: a client paying a link that
 *   outlived a voided invoice, most of all, which is real money sitting in
 *   the pilot's Stripe balance against a dead document). A human has to
 *   look. Amber.
 *
 *   MONEY IS ON ITS WAY, OR NEVER CAME — 'payment_pending' (a bank debit
 *   authorised and settling; nothing to do, and it takes itself off the
 *   screen when it lands) and 'payment_failed' (the debit failed; the link
 *   was spent at authorisation and needs replacing). The first of those is
 *   INFORMATION, and dressing it as a warning would be the fastest way to
 *   teach a pilot to ignore warnings.
 *
 * 20260813120000 added the last two.
 */
export type ConnectNoticeRow = {
  id: string;
  connected_account_id: string;
  detail: string | null;
  /** The stored outcome; null only for a row written before it was set. */
  outcome?: string | null;
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
  // `wasCorrected` comes from the refetched `payments` prop and can lag a
  // correction THIS form just submitted (revalidatePath race). state.saved
  // is this form's own ground truth for that case, so either one means the
  // correction has landed — without state.saved here, a dismissed notice
  // with a not-yet-refreshed `wasCorrected` fell through to the full
  // correction form again on a payment already corrected.
  const corrected = wasCorrected || state.saved;

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
  if (corrected && !notice) {
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
        {!corrected ? (
          <>
            <Text size="1" color="gray">
              {`This cancels the ${formatCents(payment.amount_cents)} entry with a matching
                correction, both stay on the invoice, so the record shows what happened.
                Enter the right payment afterwards.`}
            </Text>
            <TextField.Root
              name="reversal_reason"
              placeholder="Why? e.g. typo, meant 450.00"
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
        {/* Mirrors the notice rendering in PaymentPanel's own record-payment
            form below — a side effect of a SUCCESSFUL correction, not a
            failure, so it renders separately from `error`. */}
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
 * "Pay online" — Stripe Connect (Standard), payment links (docs/PLAN.md
 * decision #8).
 *
 * THE "RECORD IT BY HAND" PARAGRAPH THAT USED TO BE HERE IS GONE, AND
 * SAYING SO IS THE POINT. It read, correctly at the time, that this button
 * only ever creates a link and that "when the client pays, the pilot sees
 * it land in their own Stripe Dashboard and records it below exactly as
 * they would a cheque or a wire — a documented, deliberate gap, not an
 * oversight". That gap was closed by
 * supabase/migrations/20260813100000_connect_auto_payments.sql. A comment
 * describing a manual step the software now performs is worse than no
 * comment: it sends the next reader looking for a hand-off that does not
 * exist, and it tells them the pilot must do something they must not do
 * twice.
 *
 * What happens now: this button still only CREATES a Stripe-hosted
 * Payment Link (a direct charge on the pilot's own connected account, no
 * application fee, no funds routed through this platform, exactly as
 * before). When the client pays it, Stripe delivers the Checkout Session
 * to app/api/stripe/connect-webhook/route.ts, which records the payment
 * onto this same invoice and advances its status. Those rows appear in
 * the list above marked "paid online"; the pilot does not re-enter them,
 * and the panel says so where they would otherwise be tempted to.
 *
 * The cost of that, stated once and honestly: it took a SECOND
 * service-role entry point to build — the first that writes tenant
 * business data rather than provisioning a tenant. Both are named in
 * lib/supabase/service-role.ts. If the Connect webhook is not configured
 * (no STRIPE_CONNECT_WEBHOOK_SECRET), nothing auto-records and the old
 * by-hand flow is exactly what happens, unchanged.
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
 *
 * A LINK'S PAYMENT METHODS ARE FIXED ONCE TOO, and this panel is careful
 * about which tense it uses about them. The control below chooses what the
 * NEXT link offers (prefilled from the account default in Settings); it
 * says nothing about a link already generated, because this product does
 * not store what an existing link offers and cannot ask Stripe for it
 * without a round trip on every render. So the copy about an existing link
 * names the AMOUNT — which is stored — and never the methods. "Send this
 * link to your client to pay $4,500 by card" was that mistake in its
 * earlier form: once a link can offer a bank debit, that sentence is a
 * guess, and it is the client who would find out it was wrong.
 */
function PayOnlinePanel({
  invoiceId,
  connected,
  existingLinkUrl,
  existingLinkAmountCents,
  balanceDueCents,
  defaultMethods,
  bankPaymentSettling,
}: {
  invoiceId: string;
  connected: boolean;
  existingLinkUrl: string | null;
  existingLinkAmountCents: number | null;
  balanceDueCents: number | null;
  /** The account default from Settings — this control's starting value. */
  defaultMethods: PaymentMethodChoice;
  /**
   * True while an unresolved 'payment_pending' notice sits on this invoice —
   * a bank debit authorised and settling.
   *
   * WHICH MEANS THE STORED LINK IS ALREADY DEAD, and this panel must stop
   * telling the pilot to send it. Stripe deactivates a link at the first
   * COMPLETED Checkout Session (restrictions.completed_sessions.limit = 1),
   * and for a bank payment that is mandate acceptance, days before the money
   * lands. The pending path deliberately leaves the URL on the invoice —
   * nothing has failed, and clearing it would erase the record of what the
   * client is paying — so for those few business days the imperative "Send
   * this link to your client to pay $4,500" is an instruction to send a URL
   * that answers with Stripe's "no longer active" page. A pilot who follows
   * it forwards a broken link to an AP desk while the blue notice above
   * says nothing is wrong.
   */
  bankPaymentSettling: boolean;
}) {
  const [state, formAction, pending] = useActionState(createInvoicePaymentLink, initialLinkState);
  // Controlled, posted through a hidden input: React 19 resets an
  // uncontrolled form on every action dispatch (see appearance-panel.tsx),
  // and a method control that silently snapped back to the account default
  // after a failed attempt would mint the wrong link on the second press.
  const [methods, setMethods] = useState<PaymentMethodChoice>(defaultMethods);
  // Rendered from the server-refreshed props for THIS render, never from
  // state.url — that flag is set once by a successful creation and never
  // clears (useActionState state never clears), so after a LATER action on
  // this same screen (recordPayment/correctPayment) retires the link,
  // state.url would still name a link that is now dead on Stripe and erased
  // from the row. createInvoicePaymentLink also calls revalidatePath, so by
  // the time state.url is set here, existingLinkUrl/existingLinkAmountCents
  // already reflect the same link — nothing is lost by reading only them.
  const url = existingLinkUrl;
  const linkAmountCents = existingLinkAmountCents;
  // A null existingLinkAmountCents is a link generated before this column
  // existed (20260810010000) and never regenerated — there's no way to know
  // what it actually charges without a Stripe round trip this panel doesn't
  // make. app/invoice/[token]/page.tsx's `linkCurrent` treats that same
  // null identically to a mismatched amount, not as "unknown, so assume
  // fine" — this has to agree, or the client reads "out of date, contact
  // your pilot" while the pilot's own screen says nothing is wrong.
  const stale =
    url !== null &&
    balanceDueCents !== null &&
    (existingLinkAmountCents === null || existingLinkAmountCents !== balanceDueCents);

  if (!connected) {
    return (
      <Text size="1" color="gray">
        Connect Stripe from Settings to let clients pay online, by card or by
        bank payment (ACH).
      </Text>
    );
  }

  return (
    <Flex direction="column" gap="2" align="start">
      {url ? (
        <Flex direction="column" gap="1" width="100%">
          {bankPaymentSettling ? (
            // NOT AN IMPERATIVE, because this link cannot be paid any more.
            // The blue notice above this panel is where the pilot reads what
            // is happening to the money; this sentence exists only to stop
            // the URL below being read as something to send.
            <Text size="1" color="gray">
              {linkAmountCents !== null
                ? `This link has been used, don't send it again. Your client authorised a bank payment of ${formatCents(linkAmountCents)} on it:`
                : "This link has been used, don't send it again. Your client authorised a bank payment on it:"}
            </Text>
          ) : !stale ? (
            <Text size="1" color="gray">
              {linkAmountCents !== null
                ? `Send this link to your client to pay ${formatCents(linkAmountCents)}:`
                : "Send this link to your client:"}
            </Text>
          ) : null}
          <TextField.Root readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          {/* THE SECOND SENTENCE IS THE ACH ONE, and it is here rather than
              in a tooltip because it is the single most surprising thing
              about a bank payment: the link is spent at AUTHORISATION, days
              before the money lands. A pilot who does not know that reads
              "used up" as "paid" and marks the invoice off.

              While a debit is actually settling, that fact is not a caveat
              any more — it is the state of this link — so it is said in the
              past tense and the "generate a new one" offer below is framed
              as a SEPARATE payment rather than a retry. */}
          {bankPaymentSettling ? (
            <Text size="1" color="gray">
              Stripe switched it off when your client authorised the debit: a
              bank payment (ACH) counts as gone through at authorisation, a few
              business days before the money actually lands. It is kept here so
              you can see what they were sent. Only generate a new link if you
              need a second, separate payment on this invoice, if this debit
              fails, this app clears the dead link and tells you to replace it.
            </Text>
          ) : (
            <Text size="1" color="gray">
              It can only be paid once. Stripe switches it off after the first
              payment goes through. A bank payment (ACH) counts as gone through the
              moment your client authorises it, which is a few business days before
              the money actually lands. Generating a new link switches this one off
              too.
            </Text>
          )}
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
        <input type="hidden" name="methods" value={methods} />
        <Flex direction="column" gap="2" align="start">
          {/* PER-INVOICE, PREFILLED FROM THE ACCOUNT DEFAULT. The same
              "account defaults prefill, the screen decides" idiom as day
              rates and payment terms — a pilot who takes cards on small
              invoices and insists on ACH for a five-figure one should not
              have to go to Settings and back. */}
          <Text as="label" size="1" color="gray" id="link-methods-label">
            What this link accepts
          </Text>
          <Select.Root
            value={methods}
            onValueChange={(value) => setMethods(value as PaymentMethodChoice)}
          >
            <Select.Trigger aria-labelledby="link-methods-label" />
            <Select.Content>
              {PAYMENT_METHOD_CHOICES.map((option) => (
                <Select.Item key={option.value} value={option.value}>
                  {option.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <Text size="1" color="gray">
            {BANK_PAYMENT_FEE_NOTE}
          </Text>
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? "Creating…" : url ? "Generate a new link" : "Generate payment link"}
          </Button>
        </Flex>
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
        {/* SEPARATE FROM `warning`, because they are separate facts about
            separate links: `warning` is "the OLD link may still be live",
            this is "the NEW one couldn't be given the bank option you
            asked for". Both can be true at once. */}
        {state.methodNotice ? (
          <Callout.Root color="amber" size="1">
            <Callout.Text>{state.methodNotice}</Callout.Text>
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

const initialReviewState: ReviewNoticeState = { error: null };

/**
 * What a notice says when its stored `detail` is null.
 *
 * ONE FALLBACK FOR FOUR OUTCOMES IS A LIE FOR TWO OF THEM. The webhook
 * always writes a detail today, so this is convention rather than a
 * guarantee — but the single sentence it used to carry ("A payment arrived
 * through this invoice's payment link and was not recorded automatically")
 * is the exact inversion of what a pending or a failed row means. A debit
 * that is still settling has not arrived, and a debit that failed never
 * will; telling a pilot money arrived in either case is the one mistake
 * this whole feature exists to prevent, and it is not worth leaving one
 * trimmed column or one future write-path away.
 */
function fallbackDetail(outcome: string | null | undefined): string {
  switch (outcome) {
    case "payment_pending":
      return "A bank payment (ACH) was started on this invoice and has not settled yet. No money has arrived, nothing has been recorded, and the balance is unchanged. There is nothing to do but wait.";
    case "payment_failed":
      return "A payment started on this invoice failed, so no money ever arrived and nothing was recorded. That payment link was used up when your client authorised it, generate a new one if they still want to pay online.";
    default:
      return "A payment arrived through this invoice's payment link and was not recorded automatically. Check Stripe before recording it yourself.";
  }
}

/**
 * Something that happened on Stripe for this invoice and did NOT become a
 * payment row.
 *
 * For 'needs_review' and 'refused' this is the visible half of the
 * double-record guard: the webhook can tell that money arrived, but not
 * whether the row already sitting on this invoice is that same money
 * entered by hand or a genuinely separate payment — and guessing wrong
 * either credits a client twice or hides a payment. So it declines, writes
 * down what it saw, and this renders that sentence where the pilot is
 * already standing. There is deliberately no "record it anyway" button:
 * the ordinary payment form is right below and is the honest way to add a
 * payment the pilot has decided is real.
 *
 * For 'payment_pending' this is not a warning at all — a bank debit has
 * been authorised and is settling, the invoice is untouched, and the only
 * correct action is none. It is blue rather than amber for exactly that
 * reason, and its button says "Hide this" rather than "I've checked this",
 * because there is nothing to check.
 *
 * WHY A PENDING NOTICE IS DISMISSIBLE AT ALL, given that the webhook
 * supersedes it automatically when the payment settles or fails: that
 * supersede is a best-effort write (see supersedePendingNotice — it must
 * not 500 a handler that has just recorded money). If it ever fails, this
 * button is the only way the notice ever leaves the screen.
 */
function ConnectNotice({
  invoiceId,
  notice,
}: {
  invoiceId: string;
  notice: ConnectNoticeRow;
}) {
  const [state, formAction, pending] = useActionState(
    markConnectNoticeReviewed,
    initialReviewState
  );

  const isPending = notice.outcome === "payment_pending";
  const color = isPending ? "blue" : "amber";

  return (
    <Callout.Root color={color} size="1" mb="3">
      <Callout.Text>{notice.detail ?? fallbackDetail(notice.outcome)}</Callout.Text>
      <form action={formAction}>
        <input type="hidden" name="invoice_id" value={invoiceId} />
        <input type="hidden" name="event_id" value={notice.id} />
        <input
          type="hidden"
          name="connected_account_id"
          value={notice.connected_account_id}
        />
        <Flex align="center" gap="2" mt="2">
          <Button type="submit" size="1" variant="soft" color={color} disabled={pending}>
            {pending ? "Hiding…" : isPending ? "Hide this" : "I’ve checked this"}
          </Button>
          {state.error ? (
            <Text size="1" color="red">
              {state.error}
            </Text>
          ) : null}
        </Flex>
      </form>
    </Callout.Root>
  );
}

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
  paymentsLoadError = false,
  connectAccountConnected,
  existingPaymentLinkUrl,
  existingPaymentLinkAmountCents,
  balanceDueCents,
  connectNotices = [],
  defaultPaymentMethods,
}: {
  invoiceId: string;
  status: "draft" | "sent" | "partial" | "paid" | "void";
  payments: PaymentRow[];
  /**
   * U3: a failed invoice_payments read degrades `payments` to `[]` the same
   * way an empty ledger would — see page.tsx's own comment on why
   * `moneyError` couldn't cover this by itself: it gates the totals block,
   * not this panel. On an invoice a client has partly paid, telling the
   * pilot "No payments recorded yet" because the READ failed is worse than
   * showing nothing, per this repo's rule that a failed query must never
   * render the same as an honest empty state.
   */
  paymentsLoadError?: boolean;
  connectAccountConnected: boolean;
  existingPaymentLinkUrl: string | null;
  existingPaymentLinkAmountCents: number | null;
  balanceDueCents: number | null;
  /**
   * Unresolved 'needs_review' and 'refused' rows from
   * pilot.stripe_connect_events for this invoice. Almost always empty —
   * these are the rare cases where a Stripe payment could not simply be
   * recorded: it looked like the same money as a hand-typed row, or the
   * invoice could not take it at all.
   */
  connectNotices?: ConnectNoticeRow[];
  /**
   * The account's Settings default for what a new payment link offers,
   * prefilling the per-invoice control. Server-resolved (lib/preferences.ts
   * is total over the stored blob), so this is always a value this build
   * recognises even for an account whose row predates the preference.
   */
  defaultPaymentMethods: PaymentMethodChoice;
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
  // A bank debit authorised on this invoice and not yet settled or failed.
  // Read from the notices rather than from the invoice row, because the
  // invoice row has nothing to say about it by design: a pending debit moves
  // no balance, no status and no payment row. See PayOnlinePanel's own prop
  // comment for what it changes and why it has to.
  const bankPaymentSettling = connectNotices.some(
    (notice) => notice.outcome === "payment_pending"
  );

  return (
    <Card size="3">
      <Text as="div" size="4" weight="bold" mb="2">
        Payments
      </Text>

      {/* Above the ledger, not below it: this is a warning about a payment
          that is NOT in the list, and putting it under the list would read
          as a footnote to rows that are fine. */}
      {connectNotices.map((notice) => (
        <ConnectNotice key={notice.id} invoiceId={invoiceId} notice={notice} />
      ))}

      {paymentsLoadError ? (
        <Text color="red">
          Couldn&rsquo;t load payments on this invoice. This is not a
          statement that none have been recorded, reload before assuming
          the balance below is current.
        </Text>
      ) : payments.length === 0 ? (
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
            // Recorded by the Connect webhook, not typed by the pilot. The
            // suffix is for the glance down a list; the sentence below the
            // row is for the moment the pilot wonders whether they still
            // have to enter this one. Both, because the cost of the pilot
            // guessing wrong is a client credited twice.
            const paidOnline = payment.source === "stripe_link";
            return (
              <Flex key={payment.id} direction="column">
                <Flex justify="between" align="center" gap="3">
                  <Text color="gray">
                    {formatDate(payment.paid_on)}
                    {payment.method ? ` · ${METHOD_LABEL[payment.method] ?? payment.method}` : ""}
                    {paidOnline ? " · paid online" : ""}
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
                {/* Where the money actually IS, said at the moment it is
                    easiest to wonder. The product never touches a client's
                    funds — a payment link is a direct charge on the pilot's
                    own connected account — but the only screen that said so
                    was Settings, once, at connect time. An invoice flipping
                    to Paid inside this app is exactly when a pilot new to
                    Stripe asks whether V1 is holding their money and when
                    "V1 pays out"; the answer is neither, and it belongs
                    here. Matches settings/connect-panel.tsx's wording. */}
                {paidOnline ? (
                  <Text size="1" color="gray">
                    Recorded automatically from your payment link. The money is in
                    your own Stripe account, paid out on Stripe&rsquo;s schedule.
                  </Text>
                ) : null}
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
            defaultMethods={defaultPaymentMethods}
            bankPaymentSettling={bankPaymentSettling}
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
