import test from "node:test";
import assert from "node:assert/strict";

const {
  BANK_METHOD,
  BANK_PAYMENT_FEE_NOTE,
  BANK_PAYMENT_REJECTED_NOTE,
  CARD_METHOD,
  DEFAULT_PAYMENT_METHOD_CHOICE,
  PAYMENT_METHOD_CHOICES,
  achCapabilityNotice,
  isPaymentMethodChoice,
  normalizePaymentMethodChoice,
  resolveOfferedMethods,
} = await import("../lib/stripe/payment-methods.ts");

/**
 * What an invoice's payment link offers.
 *
 * The two things that would actually cost somebody here:
 *
 *   AN UNPAYABLE LINK. Every path through resolveOfferedMethods must
 *   produce a non-empty method list. A pilot whose Stripe account has not
 *   been granted the ACH capability, and who has set "bank only", still has
 *   an invoice to collect — dropping the bank option is the right answer,
 *   refusing to generate anything is not.
 *
 *   A FEE CLAIM THIS PRODUCT CANNOT STAND BEHIND. Stripe's pricing is
 *   per-account and changes. No percentage, no cap and no dollar figure may
 *   appear in copy that tells a pilot what they will be charged.
 */

test("the default offers both, so ACH is added without taking cards away", () => {
  // Not 'card' (the feature would be opt-in and therefore unused) and not
  // 'ach' (it would silently remove a way to pay from every existing
  // account — a client who was going to pay by card today could not).
  assert.equal(DEFAULT_PAYMENT_METHOD_CHOICE, "card_ach");
  const offered = resolveOfferedMethods({ choice: "card_ach", capability: "active" });
  assert.deepEqual([...offered.types], [CARD_METHOD, BANK_METHOD]);
  assert.equal(offered.achDropped, false);
  assert.equal(offered.note, null);
});

test("bank-only really is bank-only when the capability is active", () => {
  const offered = resolveOfferedMethods({ choice: "ach", capability: "active" });
  assert.deepEqual([...offered.types], [BANK_METHOD]);
  assert.equal(offered.note, null);
});

test("card-only never asks for a bank method, whatever the capability says", () => {
  // The link generator skips the Stripe capability read entirely for this
  // choice and passes 'inactive' as "we did not establish it". That must
  // never produce a sentence about ACH the pilot did not ask for.
  for (const capability of ["active", "inactive", "pending", "unknown"]) {
    const offered = resolveOfferedMethods({ choice: "card", capability });
    assert.deepEqual([...offered.types], [CARD_METHOD]);
    assert.equal(offered.achDropped, false);
    assert.equal(offered.note, null, `capability ${capability} produced a note`);
  }
});

test("a missing capability drops the bank option and never the link", () => {
  // THE CASE THIS FUNCTION EXISTS FOR. us_bank_account_ach_payments must be
  // active on the PILOT'S connected account (Stripe's ACH + Connect docs),
  // and this platform can read that but cannot grant it. Every non-active
  // state still yields a payable link.
  for (const capability of ["inactive", "pending", "unknown"]) {
    for (const choice of ["ach", "card_ach"]) {
      const offered = resolveOfferedMethods({ choice, capability });
      assert.deepEqual(
        [...offered.types],
        [CARD_METHOD],
        `${choice}/${capability} did not fall back to card`
      );
      assert.equal(offered.achDropped, true);
      assert.match(offered.note ?? "", /bank payments? \(ACH\)/i);
      // The pilot has to be told the invoice is still collectable, or the
      // sentence reads as "your link is broken".
      assert.match(offered.note ?? "", /cards only/);
    }
  }
});

test("'pending' is treated as not-yet-usable, not as usable-soon", () => {
  // A link is minted NOW and a client may pay it within the hour, so a
  // capability Stripe is still reviewing cannot be offered.
  const offered = resolveOfferedMethods({ choice: "card_ach", capability: "pending" });
  assert.equal(offered.achDropped, true);
  assert.match(offered.note ?? "", /hasn't finished/);
});

test("a failed capability read says so rather than blaming the pilot", () => {
  // 'unknown' is this product's value, not Stripe's: it means "we could not
  // ask". Telling a pilot to go turn on a setting that is already on would
  // send them to the wrong screen.
  const offered = resolveOfferedMethods({ choice: "ach", capability: "unknown" });
  assert.match(offered.note ?? "", /couldn't check/);
  assert.match(offered.note ?? "", /again/);
});

test("no method list is ever empty", () => {
  for (const choice of ["card", "ach", "card_ach"]) {
    for (const capability of ["active", "inactive", "pending", "unknown"]) {
      const offered = resolveOfferedMethods({ choice, capability });
      assert.ok(offered.types.length > 0, `${choice}/${capability} offered nothing`);
    }
  }
});

test("an unrecognised stored or posted choice resolves to the default", () => {
  // Total over unknown, for the reason lib/preferences.ts's header gives:
  // the stored blob outlives the code that wrote it, and `payments` is
  // ABSENT from every row written before this build.
  assert.equal(normalizePaymentMethodChoice(undefined), DEFAULT_PAYMENT_METHOD_CHOICE);
  assert.equal(normalizePaymentMethodChoice(null), DEFAULT_PAYMENT_METHOD_CHOICE);
  assert.equal(normalizePaymentMethodChoice("wire"), DEFAULT_PAYMENT_METHOD_CHOICE);
  assert.equal(normalizePaymentMethodChoice({ methods: "ach" }), DEFAULT_PAYMENT_METHOD_CHOICE);
  assert.equal(normalizePaymentMethodChoice("ach"), "ach");
  assert.equal(isPaymentMethodChoice("ach"), true);
  assert.equal(isPaymentMethodChoice("bank"), false);
});

test("every offered choice is one the resolver understands", () => {
  // The Settings panel and the per-invoice control both render this list
  // and post its `value` straight through. An entry the resolver did not
  // know would be silently defaulted on save — a control that appears to
  // work and does not.
  assert.equal(PAYMENT_METHOD_CHOICES.length, 3);
  for (const option of PAYMENT_METHOD_CHOICES) {
    assert.equal(isPaymentMethodChoice(option.value), true, option.value);
    assert.ok(option.label.length > 0);
    assert.ok(option.hint.length > 0);
  }
});

test("no copy in this module states a Stripe fee as fact", () => {
  // THE HONESTY RULE, made mechanical. Stripe's schedule is per-account and
  // volatile; a percentage or a cap typed into UI copy is a claim about
  // money this product never touches and cannot verify. The shape of the
  // difference is stable and true; the numbers are not ours to state.
  const copy = [
    BANK_PAYMENT_FEE_NOTE,
    BANK_PAYMENT_REJECTED_NOTE,
    ...PAYMENT_METHOD_CHOICES.map((option) => `${option.label} ${option.hint}`),
    ...["active", "inactive", "pending", "unknown"].map((c) => achCapabilityNotice(c) ?? ""),
    ...["card", "ach", "card_ach"].flatMap((choice) =>
      ["inactive", "pending", "unknown"].map(
        (capability) => resolveOfferedMethods({ choice, capability }).note ?? ""
      )
    ),
  ].join(" ");
  assert.doesNotMatch(copy, /\d+(\.\d+)?\s*%/, "a percentage reached pilot-facing copy");
  assert.doesNotMatch(copy, /\$\s?\d/, "a dollar figure reached pilot-facing copy");
  assert.doesNotMatch(copy, /\d+\s*(bps|basis points|¢|cents)/i);
  // ...and it still says the useful, true thing.
  assert.match(BANK_PAYMENT_FEE_NOTE, /lower Stripe processing fee/);
  assert.match(BANK_PAYMENT_FEE_NOTE, /business days/);
  assert.match(BANK_PAYMENT_FEE_NOTE, /stripe\.com\/pricing/);
});

test("a working capability raises no notice at all", () => {
  // A reassuring banner nobody needed is noise, and noise is what teaches
  // people to stop reading banners.
  assert.equal(achCapabilityNotice("active"), null);
  for (const capability of ["inactive", "pending", "unknown"]) {
    assert.ok((achCapabilityNotice(capability) ?? "").length > 0, capability);
  }
});
