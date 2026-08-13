"use client";

import { useActionState, useState } from "react";
import { Button, Callout, Card, Flex, Heading, RadioGroup, Text } from "@/components/ui";
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
   * AMBER ONLY WHEN THE CAPABILITY CONTRADICTS AN EXPLICIT CHOICE.
   *
   * "Card and bank payment (ACH)" is the DEFAULT for every account
   * (DEFAULT_PAYMENT_METHOD_CHOICE), and most connected Stripe accounts do
   * not have `us_bank_account_ach_payments` active to begin with — so an
   * amber callout here is the ROUTINE state for a pilot who never asked for
   * ACH at all, on a screen they opened for something else. That is exactly
   * the failure this codebase argues against elsewhere in its own words
   * (20260813120000: dressing information as a warning is how a pilot learns
   * to dismiss warnings), and the warning it would teach them to skim is the
   * amber one on an invoice saying a client paid five figures through a link
   * on a voided document.
   *
   * So: gray for 'card_ach', where nothing the pilot asked for is being
   * denied — links still work, they take cards, and the bank option appears
   * when Stripe switches it on. Amber for 'ach', where the pilot has
   * deliberately turned cards OFF and every link this account mints will
   * silently come out card-only anyway; that is a live contradiction between
   * a saved setting and what actually happens, and it has earned the colour.
   *
   * The per-link `methodNotice` on the invoice screen stays amber in both
   * cases — it answers an explicit "generate a link for THIS invoice" and
   * reports what that one link actually got.
   */
  const capabilityColor = choice === "ach" ? "amber" : "gray";

  return (
    <Card>
      <form action={formAction}>
        <Flex direction="column" gap="3" p="1">
          <input type="hidden" name="methods" value={choice} />

          <Flex direction="column" gap="1">
            <Heading size="4">How clients can pay</Heading>
            <Text size="2" color="gray">
              What a new payment link offers. It doesn&rsquo;t change a link
              you&rsquo;ve already sent — a link&rsquo;s payment options are fixed
              when it&rsquo;s created, so change this and generate a new one.
            </Text>
          </Flex>

          <RadioGroup.Root
            value={choice}
            onValueChange={(value) => setChoice(value as PaymentMethodChoice)}
            disabled={!canEdit}
            aria-label="What a new payment link offers"
          >
            <Flex direction="column" gap="2">
              {PAYMENT_METHOD_CHOICES.map((option) => (
                <Text as="label" size="2" key={option.value}>
                  <Flex gap="2" align="start">
                    <RadioGroup.Item value={option.value} />
                    <Flex direction="column">
                      <Text size="2">{option.label}</Text>
                      <Text size="1" color="gray">
                        {option.hint}
                      </Text>
                    </Flex>
                  </Flex>
                </Text>
              ))}
            </Flex>
          </RadioGroup.Root>

          <Text size="1" color="gray">
            {BANK_PAYMENT_FEE_NOTE}
          </Text>

          {/* WHEN THE INVOICE IS MARKED PAID, said on the screen where the
              pilot chooses to be paid this way. The fee note above covers
              the money; this covers the timing, and the timing is the half
              that costs somebody something: a pilot who reads "your client
              paid" at authorisation marks the invoice off days before the
              debit settles, and this product's whole position is that
              unsettled money has not been received. One exported sentence
              (BANK_PAYMENT_SETTLES_NOTE) rather than a fourth hand-written
              wording of it. */}
          {wantsBank ? (
            <Text size="1" color="gray">
              {BANK_PAYMENT_SETTLES_NOTE}
            </Text>
          ) : null}

          {showCapabilityNotice ? (
            <Callout.Root color={capabilityColor} size="1">
              <Callout.Text>{capabilityNotice}</Callout.Text>
            </Callout.Root>
          ) : null}

          <div role="alert" aria-live="polite">
            {state.error ? (
              <Text size="1" color="red">
                {state.error}
              </Text>
            ) : state.saved && !dirty ? (
              <Text size="1" color="green">
                Saved.
              </Text>
            ) : dirty ? (
              <Text size="1" color="amber">
                Not saved yet.
              </Text>
            ) : null}
          </div>

          {canEdit ? (
            <Flex>
              <Button type="submit" variant="outline" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </Flex>
          ) : (
            <Text size="1" color="gray">
              Only the account owner can change this.
            </Text>
          )}
        </Flex>
      </form>
    </Card>
  );
}
