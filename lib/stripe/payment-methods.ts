/**
 * WHICH METHODS AN INVOICE'S PAYMENT LINK OFFERS, and what to say when the
 * answer is not the one the pilot asked for.
 *
 * DELIBERATELY PURE — no imports, no "server-only", no Stripe SDK types,
 * the same discipline lib/stripe/connect-payments.ts states for itself and
 * for the same reason: this decides what a client is allowed to pay with,
 * it has exactly one honest answer per (choice, capability) pair, and it
 * has to be testable with nothing installed (tests/payment-methods.test.mjs).
 * The Stripe calls live in lib/stripe/connect.ts; the read of the pilot's
 * stored choice lives in lib/preferences.ts.
 *
 * WHY ACH IS WORTH THE TROUBLE, in this product specifically. A contract
 * pilot's invoice is a day-rate invoice paid by an operator's or management
 * company's accounts-payable desk, and in that market cheque and ACH
 * dominate while card rails are rare — precisely because a card fee on a
 * five-figure invoice is real money out of the pilot's pocket. Offering a
 * bank debit beside the card is the difference between "pay online" being
 * a convenience and being the way this invoice actually gets paid.
 *
 * WHAT ACH COSTS, and it is not nothing: an ACH debit is a DELAYED
 * NOTIFICATION method. The client accepts the mandate and the Checkout
 * Session completes, but the money has not moved and can still fail for
 * days afterwards. Everything about that lives in
 * lib/stripe/connect-payments.ts — nothing in this file decides when money
 * is recorded.
 *
 * VERIFIED AGAINST THE INSTALLED SDK AND CURRENT STRIPE DOCS (2026-08-13,
 * via the Stripe docs tool, not from memory):
 *   - stripe@22.4.0's PaymentLinkCreateParams.payment_method_types accepts
 *     'us_bank_account' (PaymentLinks.d.ts:779, :1016), and the product
 *     support matrix on docs.stripe.com/payments/ach-direct-debit lists
 *     BOTH "Payment Links" and "Connect" as supported. A direct charge on
 *     a Standard connected account is therefore a shape ACH really works
 *     in — no charge-type change, no application fee, nothing about
 *     lib/stripe/connect.ts's Connect model moves.
 *   - THE CAPABILITY IS REQUIRED: "Set the us_bank_account_ach_payments
 *     capability to active on your platform account, and for any connected
 *     accounts you want to enable for ACH debits." So the answer is not
 *     ours alone to give, which is the entire reason this function takes a
 *     capability and can refuse.
 *   - PER-LINK ACH OPTIONS DO NOT EXIST in this SDK:
 *     PaymentLinkCreateParams.PaymentMethodOptions carries ONLY `card`
 *     (PaymentLinks.d.ts:1010-1015). There is no per-link
 *     `us_bank_account.verification_method`, so Checkout's own default —
 *     instant bank verification with a manual-entry/microdeposit fallback
 *     — is what a client gets, and this module cannot change it. Said out
 *     loud because a reader will look for the knob.
 */

/** What the pilot asked for. Stored in account_preferences, or posted per invoice. */
export type PaymentMethodChoice = "card" | "ach" | "card_ach";

/**
 * BOTH, by default.
 *
 * Not 'card' (which would make this whole feature opt-in and therefore
 * unused) and not 'ach' (which would silently remove a way to pay from
 * every pilot who never opened Settings — a client who was going to pay by
 * card today would find they could not). Offering both adds a cheaper,
 * slower option beside the one that already worked, and takes nothing
 * away. A pilot who wants to steer an AP desk off cards picks 'ach'
 * deliberately, per account or per invoice.
 */
export const DEFAULT_PAYMENT_METHOD_CHOICE: PaymentMethodChoice = "card_ach";

/**
 * The choices, in the order they are offered, with the sentence that makes
 * each one a decision rather than a guess. One list, used by the Settings
 * panel and by the per-invoice control, so the two can never drift.
 */
export const PAYMENT_METHOD_CHOICES = [
  {
    value: "card_ach",
    label: "Card and bank payment (ACH)",
    hint: "Your client picks. Most will take the bank option on a large invoice.",
  },
  {
    value: "ach",
    label: "Bank payment (ACH) only",
    hint: "No card option at all. Lowest fee, and a few business days to settle.",
  },
  {
    value: "card",
    label: "Card only",
    hint: "Fastest to settle, and the most expensive way for you to be paid.",
  },
] as const satisfies readonly { value: PaymentMethodChoice; label: string; hint: string }[];

export function isPaymentMethodChoice(value: unknown): value is PaymentMethodChoice {
  return value === "card" || value === "ach" || value === "card_ach";
}

/**
 * Untrusted input → a choice this build recognises. TOTAL; never throws.
 *
 * Used on the READ side too, not just on write, for the reason
 * lib/preferences.ts's header gives at length: the stored blob outlives the
 * code that wrote it, so an unrecognised value has to resolve to the
 * product's default rather than reaching a Stripe call.
 */
export function normalizePaymentMethodChoice(raw: unknown): PaymentMethodChoice {
  return isPaymentMethodChoice(raw) ? raw : DEFAULT_PAYMENT_METHOD_CHOICE;
}

/**
 * Stripe's own status for `us_bank_account_ach_payments` on the connected
 * account ('active' | 'inactive' | 'pending' per the installed SDK's
 * Accounts.d.ts:850), plus one value Stripe does not have: 'unknown', for
 * when we could not ask. Guessing 'active' there would mint a link Stripe
 * rejects; guessing 'inactive' would silently drop ACH from a pilot who has
 * it. So it is its own case with its own sentence.
 */
export type AchCapability = "active" | "inactive" | "pending" | "unknown";

/** Stripe's `payment_method_types` values this product ever asks for. */
export const CARD_METHOD = "card";
export const BANK_METHOD = "us_bank_account";

export type OfferedMethods = {
  /**
   * Exactly what to pass as `payment_method_types`. NEVER empty — a link
   * that offers nothing is a link that cannot be paid, and the point of
   * every fallback below is that the invoice stays collectable.
   */
  types: readonly string[];
  /** True when a bank payment was asked for and is not being offered. */
  achDropped: boolean;
  /**
   * The sentence the pilot reads when they asked for something they did not
   * get. Null when the ask was honoured — there is nothing to explain, and
   * a reassuring note nobody needed is just noise on the screen.
   */
  note: string | null;
};

/**
 * ACH IS DROPPED, NEVER THE WHOLE LINK. A pilot who has set "bank payment
 * only" and whose Stripe account has not been granted the capability still
 * has an invoice to collect; refusing to generate anything would leave them
 * with no online payment at all and a message about a Stripe capability
 * they have never heard of. So the link is created card-only and the reason
 * is put in front of them — the map's rule, and the honest one: degrade the
 * feature, never the collection, and never silently.
 *
 * 'pending' is treated as not-yet-usable rather than as usable-soon,
 * because a link is minted NOW and a client may pay it within the hour.
 */
export function resolveOfferedMethods(input: {
  choice: PaymentMethodChoice;
  capability: AchCapability;
}): OfferedMethods {
  const wantsBank = input.choice === "ach" || input.choice === "card_ach";
  const wantsCard = input.choice === "card" || input.choice === "card_ach";

  if (!wantsBank) {
    return { types: [CARD_METHOD], achDropped: false, note: null };
  }

  if (input.capability === "active") {
    return {
      types: wantsCard ? [CARD_METHOD, BANK_METHOD] : [BANK_METHOD],
      achDropped: false,
      note: null,
    };
  }

  return {
    types: [CARD_METHOD],
    achDropped: true,
    note: achUnavailableNote(input.capability, input.choice),
  };
}

/**
 * NO PERCENTAGES, ANYWHERE, AS FACT.
 *
 * Stripe's fee schedule is per-account, negotiable, and changes; a number
 * hardcoded in a React component is a claim this product cannot stand
 * behind about money that is not ours. (The 5% + $1 band in
 * lib/stripe/connect-payments.ts cites figures in a CODE COMMENT to size a
 * tolerance — that is a different thing from telling a pilot what they will
 * be charged, and it is deliberately not promoted into UI.) So: the shape
 * of the difference, which is stable and true, and a pointer at the only
 * two places the real number lives.
 *
 * PILOT-FACING ONLY. This must never render on app/invoice/[token]/page.tsx
 * — that page is the client's copy of the invoice, read by an operator's AP
 * desk, and what the pilot pays Stripe is none of their business.
 */
export const BANK_PAYMENT_FEE_NOTE =
  "Bank payments (ACH) usually carry a lower Stripe processing fee than cards, and take a few business days to settle instead of landing straight away. What you actually pay depends on your own Stripe pricing. Check your Stripe Dashboard or stripe.com/pricing.";

/**
 * When Stripe itself refused the bank method at create time.
 *
 * The capability pre-check should make this unreachable; it is here because
 * a capability can be revoked between the check and the call, and because
 * the exact failure shape for an inactive capability on a Payment Link has
 * not been observed here (see isStripeRequestRejection in
 * lib/stripe/connect.ts). If this sentence ever shows up in the wild, the
 * pre-check missed something and the wording should send the pilot to the
 * same place it would have.
 */
export const BANK_PAYMENT_REJECTED_NOTE =
  "Stripe wouldn't put a bank payment (ACH) option on this link, so it was created for cards only. Your client can still pay it. That usually means ACH Direct Debit isn't active on your Stripe account: check Settings → Payment methods in your own Stripe Dashboard.";

/**
 * WHEN THE INVOICE IS MARKED PAID, for the screen where a pilot chooses to
 * be paid by bank debit (app/(app)/settings/payment-methods-panel.tsx).
 *
 * The second sentence is the load-bearing one and it is deliberately not
 * hedged: authorisation is not payment. Everything else this product says
 * about ACH timing hangs off that — the blue pending notice on an invoice,
 * the "this link has been used" wording beside a settling debit, the
 * webhook's refusal to write a payment row before
 * `async_payment_succeeded`. Said here in the pilot's own words so the
 * setting and the behaviour agree.
 *
 * NOT the same sentence as the invoice panel's note about an existing link,
 * and the two are not interchangeable: that one is about the LINK being
 * spent at authorisation (why it stops working), this one is about the
 * INVOICE not being paid at authorisation (why it stays outstanding). If a
 * third settle-time sentence is ever needed, check first whether it is
 * really one of these two.
 *
 * PILOT-FACING ONLY, on the same rule as BANK_PAYMENT_FEE_NOTE: never
 * render it on app/invoice/[token]/page.tsx.
 */
export const BANK_PAYMENT_SETTLES_NOTE =
  "A bank payment is not instant: your client authorises it at checkout and the money moves a few business days later. This invoice is marked paid when it settles, not when they authorise it.";

function achUnavailableNote(
  capability: Exclude<AchCapability, "active">,
  choice: PaymentMethodChoice
): string {
  const consequence =
    choice === "ach"
      ? "so this link takes cards only; your client can still pay it."
      : "so this link takes cards only.";

  switch (capability) {
    case "pending":
      return `Stripe hasn't finished switching bank payments (ACH) on for your Stripe account yet, ${consequence} Once Stripe marks it active, generate a new link and the bank option appears.`;
    case "unknown":
      return `We couldn't check with Stripe whether bank payments (ACH) are switched on for your account, ${consequence} Try generating the link again in a moment.`;
    default:
      // 'inactive'. Two different things can produce it and the pilot
      // cannot tell them apart from here, so the sentence covers both
      // rather than sending them confidently to the wrong screen: ACH
      // Direct Debit not enabled in their own payment-method settings, or
      // the us_bank_account_ach_payments capability not granted on the
      // account. Stripe's own docs describe both, and which one applies is
      // not visible to this platform.
      return `Bank payments (ACH) aren't active on your Stripe account, ${consequence} Turn on ACH Direct Debit under Settings → Payment methods in your own Stripe Dashboard, then generate a new link. If it's already on there, the ACH capability on your account hasn't been granted yet and Stripe support can tell you what's outstanding.`;
  }
}

/**
 * What the Settings panel says about the capability, standing alone (no
 * link is being generated, so there is no fallback to explain — just the
 * state of the account).
 *
 * Returns null for 'active': a working thing does not need a notice.
 */
export function achCapabilityNotice(capability: AchCapability): string | null {
  switch (capability) {
    case "active":
      return null;
    case "pending":
      return "Stripe is still switching bank payments (ACH) on for your account. Until it's active, links take cards only.";
    case "unknown":
      return "We couldn't check with Stripe whether bank payments (ACH) are switched on for your account. If links keep coming out card-only, check ACH Direct Debit in your own Stripe Dashboard.";
    default:
      return "Bank payments (ACH) aren't active on your Stripe account yet, so links take cards only. Turn on ACH Direct Debit under Settings → Payment methods in your Stripe Dashboard.";
  }
}
