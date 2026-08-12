"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import {
  Box,
  Button,
  Card,
  Flex,
  SegmentedControl,
  Text,
  TextField,
} from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { signUp, type SignUpState } from "./actions";

const initialState: SignUpState = { error: null };

export default function SignUpForm() {
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
      <Card size="4" style={{ width: "100%", maxWidth: "22rem" }}>
        <Flex direction="column" align="center" gap="3" style={{ textAlign: "center" }}>
          <Text size="5" weight="bold">
            Check your email
          </Text>
          <Text size="2" color="gray">
            Click the confirmation link we just sent, then sign in to start
            your trial.
          </Text>
          <Button asChild mt="2">
            <NextLink href="/login">Go to sign in</NextLink>
          </Button>
        </Flex>
      </Card>
    );
  }

  return (
    <Card size="4" style={{ width: "100%", maxWidth: "22rem" }}>
      <form action={formAction}>
        <Flex direction="column" gap="3">
          <Flex direction="column" align="center" gap="1" mb="1">
            <Text size="6" weight="bold">
              Start your trial
            </Text>
            <Text size="2" color="gray">
              {BRAND.name} — {BRAND.descriptor}
            </Text>
          </Flex>

          <Box>
            <Text as="label" size="2" weight="medium" htmlFor="full_name">
              Your name
            </Text>
            <TextField.Root
              id="full_name"
              name="full_name"
              autoComplete="name"
              required
              mt="1"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </Box>

          <Box>
            <Text as="label" size="2" weight="medium">
              Account type
            </Text>
            {/* A hidden input carries the value: SegmentedControl is not a
                native form control, so a plain <form> POST (the no-JS path)
                would not otherwise submit it. */}
            <input type="hidden" name="account_kind" value={accountKind} />
            <SegmentedControl.Root
              value={accountKind}
              onValueChange={setAccountKind}
              mt="1"
              size="2"
            >
              <SegmentedControl.Item value="solo">
                Just me
              </SegmentedControl.Item>
              <SegmentedControl.Item value="business">
                A business
              </SegmentedControl.Item>
            </SegmentedControl.Root>
            <Text as="div" size="1" color="gray" mt="1">
              You can change how you bill later — this just sets up your
              account.
            </Text>
          </Box>

          <Box>
            <Text as="label" size="2" weight="medium" htmlFor="email">
              Email
            </Text>
            <TextField.Root
              id="email"
              type="email"
              name="email"
              autoComplete="email"
              required
              mt="1"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Box>
          <Box>
            <Text as="label" size="2" weight="medium" htmlFor="password">
              Password
            </Text>
            <TextField.Root
              id="password"
              type="password"
              name="password"
              autoComplete="new-password"
              required
              mt="1"
            />
            <Text as="div" size="1" color="gray" mt="1">
              At least 8 characters
            </Text>
          </Box>

          <Box>
            <Text as="label" size="2" weight="medium" htmlFor="home_base">
              Based airport <Text color="gray">(optional)</Text>
            </Text>
            <TextField.Root
              id="home_base"
              name="home_base"
              autoCapitalize="characters"
              placeholder="e.g. KTEB"
              mt="1"
              value={homeBase}
              onChange={(e) => setHomeBase(e.target.value)}
            />
          </Box>

          {state.error ? (
            <Text size="1" color="red" role="alert" aria-live="polite">
              {state.error}
            </Text>
          ) : null}

          <Button type="submit" disabled={pending} mt="1">
            {pending ? "Creating account…" : "Create account"}
          </Button>

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
            <Text asChild size="1">
              <NextLink href="/terms">Terms</NextLink>
            </Text>{" "}
            and{" "}
            <Text asChild size="1">
              <NextLink href="/privacy">Privacy Policy</NextLink>
            </Text>
            .
          </Text>

          <Text size="1" color="gray" align="center">
            Already have an account?{" "}
            <Text asChild size="1">
              <NextLink href="/login">Sign in</NextLink>
            </Text>
          </Text>
        </Flex>
      </form>
    </Card>
  );
}
