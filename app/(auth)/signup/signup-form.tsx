"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import { CheckCircledIcon } from "@radix-ui/react-icons";
import {
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Link,
  SegmentedControl,
  Text,
  TextField,
} from "@/components/ui";
import {
  AuthFooter,
  AuthHeading,
  Field,
  FormError,
  SubmitButton,
} from "../auth-parts";
import { signUp, type SignUpState } from "./actions";

const initialState: SignUpState = { error: null };

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
  const [accountKind, setAccountKind] = useState("solo");

  if (state.needsConfirmation) {
    return (
      <Flex direction="column" gap="5">
        <Flex direction="column" gap="3" align="start">
          <Text color="indigo" aria-hidden>
            <CheckCircledIcon width="32" height="32" />
          </Text>
          <Heading as="h1" size="7" trim="start">
            Check your email
          </Heading>
          <Text as="p" size="2" color="gray">
            Click the confirmation link we just sent, then sign in to start
            your trial.
          </Text>
        </Flex>
        <Button asChild size="3" style={{ width: "100%" }}>
          <NextLink href="/login">Go to sign in</NextLink>
        </Button>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="6">
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

      <form action={formAction}>
        <Flex direction="column" gap="4">
          {/* Name and base sit on one row so the form reads as four
              questions rather than six. */}
          <Grid columns={{ initial: "1", xs: "3fr 2fr" }} gap="4">
            <Field id="full_name" label="Your name">
              <TextField.Root
                id="full_name"
                name="full_name"
                size="3"
                autoComplete="name"
                autoFocus
                required
                disabled={pending}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </Field>

            <Field id="home_base" label="Based airport" optional>
              <TextField.Root
                id="home_base"
                name="home_base"
                size="3"
                autoCapitalize="characters"
                placeholder="KTEB"
                disabled={pending}
                value={homeBase}
                onChange={(e) => setHomeBase(e.target.value)}
              />
            </Field>
          </Grid>

          {/* NOT a <label>: SegmentedControl.Root is Radix ToggleGroup —
              role="group" with <button> items, not a native control — so a
              <label> with no htmlFor and nothing wrapped is dropped from the
              accessibility tree entirely, and this field decides whether the
              account is a sole proprietor or a business. The group is named
              by aria-labelledby and described by the hint instead, which is
              the only wiring a non-native control has. Field() in
              ../auth-parts does the native equivalent with htmlFor. */}
          <Flex direction="column" gap="1">
            <Text as="div" id="account-kind-label" size="2" weight="medium">
              Account type
            </Text>
            {/* A hidden input carries the value: SegmentedControl is not a
                native form control, so a plain <form> POST (the no-JS path)
                would not otherwise submit it. */}
            <input type="hidden" name="account_kind" value={accountKind} />
            <SegmentedControl.Root
              value={accountKind}
              onValueChange={setAccountKind}
              size="3"
              aria-labelledby="account-kind-label"
              aria-describedby="account-kind-hint"
            >
              <SegmentedControl.Item value="solo">Just me</SegmentedControl.Item>
              <SegmentedControl.Item value="business">
                A business
              </SegmentedControl.Item>
            </SegmentedControl.Root>
            <Text as="div" id="account-kind-hint" size="1" color="gray">
              You can change how you bill later — this just sets up your
              account.
            </Text>
          </Flex>

          <Field id="email" label="Email">
            <TextField.Root
              id="email"
              type="email"
              name="email"
              size="3"
              autoComplete="email"
              required
              disabled={pending}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field id="password" label="Password" hint="At least 8 characters">
            <TextField.Root
              id="password"
              type="password"
              name="password"
              size="3"
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
          <Box
            p="3"
            style={{
              background: "var(--gray-2)",
              border: "1px solid var(--gray-a5)",
              borderRadius: "var(--radius-3)",
            }}
          >
            <Flex direction="column" gap="1">
              <Text size="2" weight="medium">
                {trialDays} days free.
              </Text>
              <Text size="1" color="gray">
                You pick a plan and enter a card on the next step. Nothing is
                charged until the trial ends.
              </Text>
            </Flex>
          </Box>

          <FormError message={state.error} />

          <SubmitButton
            pending={pending}
            idle="Create account"
            busy="Creating account…"
          />

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
          <Text size="1" color="gray" align="center">
            See our{" "}
            <Link asChild size="1">
              <NextLink href="/terms">Terms</NextLink>
            </Link>{" "}
            and{" "}
            <Link asChild size="1">
              <NextLink href="/privacy">Privacy Policy</NextLink>
            </Link>
            .
          </Text>
        </Flex>
      </form>

      <AuthFooter>
        <Text size="2" color="gray">
          Already have an account?{" "}
          <Link asChild size="2">
            <NextLink href="/login">Sign in</NextLink>
          </Link>
        </Text>
      </AuthFooter>
    </Flex>
  );
}