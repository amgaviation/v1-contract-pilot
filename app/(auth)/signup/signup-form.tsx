"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import { LCard } from "@/components/ledger";
import { LInput } from "@/components/ledger/forms";
import { cn } from "@/lib/ledger/cn";
import { AuthFooter, AuthHeading, Field, FormError, SubmitButton } from "../auth-parts";
import { signUp, type SignUpState } from "./actions";

const initialState: SignUpState = { error: null };

/**
 * A two-option pill toggle, styled in place of Radix's SegmentedControl.
 * `role="radiogroup"` + `role="radio"` buttons, not a native control — same
 * accessibility shape the Radix version carried, and the same reason this
 * field is named by `aria-labelledby` and described by the hint rather than
 * a `<label htmlFor>`: nothing here is a single focusable element a label
 * could point at.
 */
function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
  labelledBy,
  describedBy,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  labelledBy: string;
  describedBy?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="inline-flex w-full gap-1 rounded-control border border-hair-strong bg-sunk p-1"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex-1 rounded-control px-3 py-1.5 text-body-s font-medium transition-colors",
              active ? "bg-card text-ink shadow-card" : "text-ink-2 hover:text-ink"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * `trialDays` is passed down from the server page rather than imported:
 * TRIAL_PERIOD_DAYS lives in lib/stripe/server.ts, which is `server-only`,
 * and this is a client component. Same pattern the welcome plan picker
 * uses. It is the SAME constant the checkout hands Stripe, so the number
 * on this screen is the trial the code enforces.
 */
export default function SignUpForm({ trialDays }: { trialDays: number }) {
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
      */}
      <AuthHeading title="Start your trial">
        Two minutes now, and your next trip drafts its own invoice and
        logbook entries.
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
          <SegmentedToggle
            value={accountKind}
            onChange={setAccountKind}
            labelledBy="account-kind-label"
            describedBy="account-kind-hint"
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

        {/* THE TRIAL TERMS, stated before the button rather than under
            it. trialDays is the checkout's own constant; the card is
            entered at Stripe's checkout on the next screen, which is why
            this says "next step" and does not ask for one here. */}
        <div className="rounded-control border border-hair bg-sunk p-3">
          <p className="text-body-s font-medium text-ink">{trialDays} days free.</p>
          <p className="text-caption text-ink-3">
            You pick a plan and enter a card on the next step. Nothing is
            charged until the trial ends.
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
  );
}
