"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import { LCard } from "@/components/ledger";
import { BRAND } from "@/lib/brand";
import { LSegmented } from "@/components/ledger/segmented";
import { LInput } from "@/components/ledger/forms";
import { AuthFooter, AuthHeading, Field, FormError, SubmitButton } from "../auth-parts";
import { signUp, type SignUpState } from "./actions";

const initialState: SignUpState = { error: null };

/**
 * `introLabel` is passed down from the server page rather than imported:
 * INTRO_FIRST_MONTH_LABEL lives in lib/stripe/server.ts, which is
 * `server-only`, and this is a client component. Same pattern the welcome
 * plan picker uses. It is the SAME constant the checkout's coupon is
 * minted from, so the price on this screen is the price the code charges.
 */
export default function SignUpForm({ introLabel }: { introLabel: string }) {
  const [state, formAction, pending] = useActionState(signUp, initialState);

  // React 19 resets an uncontrolled form on every action dispatch,
  // including the error path — a rejected submit would otherwise blank
  // every field. Keep the ones a pilot has typed controlled so they
  // survive; the password is intentionally never echoed back.
  //
  // These identity fields are the "light" half of the hybrid onboarding:
  // just enough to name the account and its owner. The rest — address,
  // certificate, rate defaults — is collected in the post-checkout wizard,
  // so signup stays a short form and a card, not a questionnaire in front
  // of the trial. They ride along in the Supabase auth user_metadata and
  // are read once at provisioning (lib/stripe/provisioning.ts); they are
  // prefill, never an authorization input.
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [homeBase, setHomeBase] = useState("");
  const [accountKind, setAccountKind] = useState<"solo" | "business">("solo");

  // The "check your email" state used to be rendered here, inline. It is a
  // page now (/check-email): the address it names comes from an httpOnly
  // cookie this component could not have held, and the state survives a
  // reload, which an action state does not. signUp redirects there.

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[10fr_11fr] lg:items-start lg:gap-8">
      {/*
        THE BRAND PANEL — the signup screen's half of the landing page's
        argument, restated where the decision actually happens. Everything
        on it is bound by docs/MARKETING.md §5 exactly as hard as the
        landing page (the §intro warning exists because THIS screen has
        overclaimed twice): the three lines below are the pilot's own verbs
        — review, send, scan, file — and the mechanics are the shipped
        ones. The trust line is claim rule 6 plus the downgrade promise,
        stated where a sceptic is deciding whether to hand over a card.

        REWRITTEN 2026-08-19 with the landing page, which is the moment
        docs/MARKETING.md warns this panel historically falls out of step:
        the heading is the landing H1 and the three lines are section 2's
        rows in the same order and the same voice. Line 3 still carries
        claim rule 1 — the PILOT marks the receipt rebill, and that tag is
        what puts it on the invoice. A trip never creates an expense.

        order-last / lg:order-first: DOM order keeps the FORM first on a
        phone — a visitor who tapped "Get started" gets the fields, not a
        billboard — while desktop reads brand left, form right.

        A <section>, deliberately NOT an <aside>: scripts/layout-verify.mjs
        detects the app shell by the presence of an <aside> and then holds
        the page to the shell's invariants (a section nav, a visible Sign
        out) — an <aside> here fails 32 viewport checks for chrome this
        page correctly does not have.
      */}
      <section
        aria-labelledby="signup-brand-heading"
        className="order-last flex flex-col gap-5 rounded-card bg-brand p-6 text-brand-ink shadow-card sm:p-8 lg:order-first lg:sticky lg:top-8"
      >
        <img src="/brand/white.svg" alt="" height={20} width={35} className="self-start" />
        <h2
          id="signup-brand-heading"
          className="font-display text-display-s font-bold text-brand-ink"
        >
          One trip entry drives the rest.
        </h2>
        <p className="text-body text-brand-ink-2">
          {BRAND.name} is a business management platform we built for
          pilots. Set up takes about two minutes and it starts working on
          the first trip you log.
        </p>
        <ul className="flex flex-col divide-y divide-brand-hair border-t border-brand-hair">
          {[
            "Log a trip, read the invoice lines it priced off your client's rate card, and send a numbered PDF with a payment link on it.",
            "Every leg comes back as a logbook draft with PIC and SIC kept apart, waiting for you to approve it.",
            "Photograph receipts at the FBO and mark each one rebill or keep. The rebills go on that client's invoice.",
          ].map((line, i) => (
            <li key={line} className="flex items-baseline gap-3 py-3">
              <span className="font-mono tnum-l text-body-s font-semibold text-brand-accent">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-body-s text-brand-ink-2">{line}</span>
            </li>
          ))}
        </ul>
        <p className="text-caption text-brand-ink-2">
          Account-wide export on every plan. Cancelling puts the account in
          read-only; nothing is deleted.
        </p>
      </section>

      <LCard className="flex flex-col gap-6 p-6 sm:p-8">
      {/*
        NOT "your next trip bills itself". Nothing bills itself: an invoice
        exists only when the pilot invokes createInvoiceDraft from
        /invoices/new, what it produces is a DRAFT they review and send,
        platform email is conditional on config plus a client address
        (docs/LAUNCH-GATES.md G10), and scheduled drafting is
        `recurring_invoices`, minTier "pro". The landing page states the
        mechanic correctly; this screen is the higher-stakes surface and
        must state it the same way. docs/MARKETING.md §1 and §5.

        THIS COMMENT OUTLASTED THE LINE IT WAS GUARDING. The copy beneath it
        read "your next trip drafts its own invoice and logbook entries",
        which is the same autonomy claim in a quieter voice: a trip that
        "drafts its own invoice" is a trip that bills itself, and the rule
        above says in as many words that the pilot invokes it. Two further
        slips in seven words — "invoice" for what is really invoice LINES,
        and "entries" for what are really per-leg DRAFTS the pilot reviews
        before anything reaches the logbook. The line now names what the
        code produces and who acts on it, matching the landing page's own
        row copy. Nothing here may give the trip a verb it does not have.
      */}
      <AuthHeading title="Start your books">
        Two minutes, and your next trip&rsquo;s invoice lines and logbook
        drafts are ready to review.
      </AuthHeading>

      <form action={formAction} className="flex flex-col gap-4">
        {/* Name and base sit on one row so the form reads as four
            questions rather than six. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[3fr_2fr]">
          <Field id="full_name" label="Your name">
            <LInput
              id="full_name"
              name="full_name"
              autoComplete="name"
              autoFocus
              required
              disabled={pending}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </Field>

          <Field id="home_base" label="Based airport" optional>
            <LInput
              id="home_base"
              name="home_base"
              autoCapitalize="characters"
              placeholder="KTEB"
              disabled={pending}
              value={homeBase}
              onChange={(e) => setHomeBase(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-1.5">
          <span id="account-kind-label" className="text-body-s font-medium text-ink">
            Account type
          </span>
          {/* A hidden input carries the value: the toggle is not a native
              form control, so a plain <form> POST (the no-JS path) would
              not otherwise submit it. */}
          <input type="hidden" name="account_kind" value={accountKind} />
          <LSegmented
            value={accountKind}
            onChange={setAccountKind}
            labelledBy="account-kind-label"
            describedBy="account-kind-hint"
            fullWidth
            options={[
              { value: "solo", label: "Just me" },
              { value: "business", label: "A business" },
            ]}
          />
          <p id="account-kind-hint" className="text-caption text-ink-3">
            You can change how you bill later. This just sets up your
            account.
          </p>
        </div>

        <Field id="email" label="Email">
          <LInput
            id="email"
            type="email"
            name="email"
            autoComplete="email"
            required
            disabled={pending}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field id="password" label="Password" hint="At least 8 characters">
          <LInput
            id="password"
            type="password"
            name="password"
            autoComplete="new-password"
            aria-describedby="password-hint"
            required
            disabled={pending}
          />
        </Field>

        {/* THE OFFER TERMS, stated before the button rather than under
            it. introLabel is the checkout's own constant; the card is
            entered at Stripe's checkout on the next screen, which is why
            this says "next step" and does not ask for one here. */}
        <div className="rounded-control border border-hair bg-sunk p-3">
          <p className="text-body-s font-medium text-ink">
            {introLabel} for your first month.
          </p>
          <p className="text-caption text-ink-3">
            You pick a plan and enter a card on the next step. Your first
            month is {introLabel}; the regular price applies after that.
          </p>
        </div>

        <FormError message={state.error} />

        <SubmitButton pending={pending} idle="Create account" busy="Creating account…" />

        {/*
          "See our", NOT "by creating an account you agree to our". Both
          linked pages say in their own bodies that no document has been
          published yet and that nothing on them is binding. Printing an
          agreement sentence over them would assert a legal fact at the exact
          moment a pilot hands over a card — one this product has no basis
          for and records nowhere. The links are honest; the sentence was
          not. It comes back when counsel's text lands and acceptance is
          actually captured (docs/LAUNCH-GATES.md G3).
        */}
        <p className="text-center text-caption text-ink-3">
          See our{" "}
          <NextLink href="/terms" className="text-accent hover:underline">
            Terms
          </NextLink>{" "}
          and{" "}
          <NextLink href="/privacy" className="text-accent hover:underline">
            Privacy Policy
          </NextLink>
          .
        </p>
      </form>

      <AuthFooter>
        <p className="text-body-s text-ink-2">
          Already have an account?{" "}
          <NextLink href="/login" className="font-medium text-accent hover:underline">
            Sign in
          </NextLink>
        </p>
      </AuthFooter>
      </LCard>
    </div>
  );
}
