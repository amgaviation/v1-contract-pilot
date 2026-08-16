"use client";

import { useActionState, useState } from "react";
import { LAlert, LButton, LCard } from "@/components/ledger";
import {
  achCapabilityNotice,
  BANK_PAYMENT_FEE_NOTE,
  BANK_PAYMENT_SETTLES_NOTE,
  PAYMENT_METHOD_CHOICES,
  type AchCapability,
  type PaymentMethodChoice,
} from "@/lib/stripe/payment-methods";
import { savePaymentMethodChoice, type PaymentMethodsState } from "./connect-actions";

const initialState: PaymentMethodsState = { error: null };

/**
 * HOW THIS ACCOUNT GETS PAID ONLINE — the account default for what a new
 * invoice payment link offers.
 *
 * WHY THIS CONTROL EXISTS AT ALL, in this product. The invoices here are a
 * contract pilot's day-rate invoices, and the person paying them is an
 * accounts-payable desk at an operator or a management company. That desk
 * pays by cheque or ACH as a matter of course; a card is the exception. On
 * a five-figure invoice the difference between the two is real money, and
 * it comes out of the pilot's side. So "which methods" is not a settings
 * nicety here, it is the feature.
 *
 * NO PERCENTAGES ANYWHERE IN THIS FILE, and BANK_PAYMENT_FEE_NOTE is where
 * that rule is written down. Stripe's pricing is per-account and changes;
 * a number typed into a React component is a claim this product cannot
 * stand behind about money it never touches. The note states the SHAPE of
 * the difference — lower fee, slower settlement — and points at the two
 * places the pilot's real number lives.
 *
 * The same note must never appear on app/invoice/[token]/page.tsx. That is
 * the client's copy of the invoice, and what the pilot pays Stripe is not
 * the AP desk's business.
 *
 * Rendered only when Stripe is connected: the choice is meaningless without
 * an account to mint links on, and an enabled control that does nothing is
 * how a settings screen starts lying.
 *
 * THE RADIO ROW IS PLAIN NATIVE `<input type="radio">`, not a shared Ledger
 * primitive — see this migration's hard rule 9: no primitive here is used
 * a second time across this panel set, so it stays local rather than
 * joining components/ledger/.
 */
export default function PaymentMethodsPanel({
  methods,
  achCapability,
  canEdit,
}: {
  methods: PaymentMethodChoice;
  /** Read from Stripe on this render; 'unknown' when the read failed. */
  achCapability: AchCapability;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(savePaymentMethodChoice, initialState);
  // Controlled through a hidden input, for the reason appearance-panel.tsx
  // records: React 19 resets an uncontrolled form on EVERY action dispatch,
  // a rejected one included, which would silently restore the control to
  // its mount-time value.
  const [choice, setChoice] = useState<PaymentMethodChoice>(methods);
  const dirty = choice !== methods;

  const wantsBank = choice === "ach" || choice === "card_ach";
  const capabilityNotice = achCapabilityNotice(achCapability);
  // Only worth raising when the pilot has actually asked for a bank
  // payment. An account set to card-only does not need to be told about a
  // capability it is not using.
  const showCapabilityNotice = capabilityNotice !== null && wantsBank;
  /**
   * WARN ONLY WHEN THE CAPABILITY CONTRADICTS AN EXPLICIT CHOICE.
   *
   * "Card and bank payment (ACH)" is the DEFAULT for every account
   * (DEFAULT_PAYMENT_METHOD_CHOICE), and most connected Stripe accounts do
   * not have `us_bank_account_ach_payments` active to begin with — so a
   * warn-toned callout here is the ROUTINE state for a pilot who never
   * asked for ACH at all, on a screen they opened for something else. That
   * is exactly the failure this codebase argues against elsewhere in its
   * own words (20260813120000: dressing information as a warning is how a
   * pilot learns to dismiss warnings), and the warning it would teach them
   * to skim is the one on an invoice saying a client paid five figures
   * through a link on a voided document.
   *
   * So: neutral for 'card_ach', where nothing the pilot asked for is being
   * denied — links still work, they take cards, and the bank option appears
   * when Stripe switches it on. Warn for 'ach', where the pilot has
   * deliberately turned cards OFF and every link this account mints will
   * silently come out card-only anyway; that is a live contradiction between
   * a saved setting and what actually happens, and it has earned the colour.
   *
   * The per-link `methodNotice` on the invoice screen stays warn in both
   * cases — it answers an explicit "generate a link for THIS invoice" and
   * reports what that one link actually got.
   */
  const capabilityTone = choice === "ach" ? "warn" : "neutral";

  return (
    <LCard>
      <form action={formAction}>
        <div className="flex flex-col gap-3">
          <input type="hidden" name="methods" value={choice} />

          <h3 className="text-h3 font-semibold text-ink">How clients can pay</h3>

          <div
            role="radiogroup"
            aria-label="What a new payment link offers"
            className="flex flex-col gap-2"
          >
            {PAYMENT_METHOD_CHOICES.map((option) => (
              <label key={option.value} className="flex items-start gap-2">
                <input
                  type="radio"
                  value={option.value}
                  checked={choice === option.value}
                  disabled={!canEdit}
                  onChange={() => setChoice(option.value)}
                  className="mt-0.5 size-4 shrink-0 accent-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-50"
                />
                <span className="flex flex-col">
                  <span className="text-body-s text-ink">{option.label}</span>
                  <span className="text-caption text-ink-3">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>

          <p className="text-caption text-ink-3">{BANK_PAYMENT_FEE_NOTE}</p>

          {/* WHEN THE INVOICE IS MARKED PAID, said on the screen where the
              pilot chooses to be paid this way. The fee note above covers
              the money; this covers the timing, and the timing is the half
              that costs somebody something: a pilot who reads "your client
              paid" at authorisation marks the invoice off days before the
              debit settles, and this product's whole position is that
              unsettled money has not been received. One exported sentence
              (BANK_PAYMENT_SETTLES_NOTE) rather than a fourth hand-written
              wording of it. */}
          {wantsBank ? <p className="text-caption text-ink-3">{BANK_PAYMENT_SETTLES_NOTE}</p> : null}

          {showCapabilityNotice ? <LAlert tone={capabilityTone}>{capabilityNotice}</LAlert> : null}

          <div role="alert" aria-live="polite">
            {state.error ? (
              <p className="text-caption font-medium text-crit">{state.error}</p>
            ) : state.saved && !dirty ? (
              <p className="text-caption font-medium text-good">Saved.</p>
            ) : dirty ? (
              <p className="text-caption font-medium text-warn">Not saved yet.</p>
            ) : null}
          </div>

          {canEdit ? (
            <div className="flex">
              <LButton type="submit" variant="outline" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </LButton>
            </div>
          ) : (
            <p className="text-body-s text-ink-3">Only the account owner can change this.</p>
          )}
        </div>
      </form>
    </LCard>
  );
}
