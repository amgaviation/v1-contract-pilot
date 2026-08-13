"use client";

import { useState, useTransition } from "react";
import NextLink from "next/link";
import {
  AlertDialog,
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Link as RadixLink,
  Separator,
  Switch,
  Text,
} from "@/components/ui";
import { setInvoiceRemindersSuppressed, createLateFeeInvoice } from "../reminder-actions";

/**
 * WHAT THE SCHEDULER IS GOING TO DO, ON THE SCREEN, BEFORE IT DOES IT.
 *
 * This panel exists because a job that emails somebody else's client on a
 * pilot's behalf is only acceptable if the pilot can see exactly what it will
 * send and when, and stop it in one press. Everything here is derived at
 * render time from the same pure functions the run itself uses
 * (lib/reminders/policy.ts) — there is no second implementation of "what is
 * due" that could drift from the one that sends.
 *
 * It renders for issued, unpaid invoices only; the invoice screen decides
 * that, matching the statuses the run itself will act on.
 */

export type ReminderRungView = {
  key: string;
  /** "7 days past due" */
  label: string;
  /** The calendar day it comes due, already formatted. */
  when: string;
  state: "sent" | "failed" | "skipped" | "upcoming";
  /** The mail service's words on a failure, or why it was skipped. */
  detail: string | null;
  /** When the row was written, already formatted. */
  at: string | null;
};

export type LateFeeView = {
  /** The pilot's own agreed terms, in a sentence. Null when none agreed. */
  policy: string | null;
  /** What it comes to today, if anything is chargeable. */
  quote: string | null;
  /** Fee invoices already raised against this one. */
  raised: { id: string; number: string | null; amount: string; when: string }[];
};

export default function ReminderPanel({
  invoiceId,
  clientName,
  clientId,
  suppressed: initialSuppressed,
  scheduleIsEmpty,
  rungs,
  nextUp,
  hold,
  canEmail,
  clientHasEmail,
  lateFee,
  manualSends,
}: {
  invoiceId: string;
  clientName: string;
  clientId: string;
  suppressed: boolean;
  /** This client has no reminder schedule at all — the default state. */
  scheduleIsEmpty: boolean;
  rungs: ReminderRungView[];
  /** "The next reminder goes out on Oct 4." — null when nothing is pending. */
  nextUp: string | null;
  /** Why nothing is going out right now, when something otherwise would. */
  hold: string | null;
  canEmail: boolean;
  clientHasEmail: boolean;
  lateFee: LateFeeView;
  /** Reminders the pilot sent by hand, newest first, already formatted. */
  manualSends: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [suppressed, setSuppressed] = useState(initialSuppressed);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card size="3">
      <Flex justify="between" align="center" mb="2">
        <Text as="div" size="4" weight="bold">
          Reminders
        </Text>
        {suppressed ? <Badge color="gray">Off for this invoice</Badge> : null}
      </Flex>

      {scheduleIsEmpty ? (
        <Text as="div" size="2" color="gray">
          Nothing goes out automatically for {clientName}.{" "}
          <RadixLink asChild>
            <NextLink href={`/clients/${clientId}`}>Set a schedule</NextLink>
          </RadixLink>{" "}
          if you want reminders sent for them, or send one now from the panel
          above.
        </Text>
      ) : (
        <>
          {/* THE SWITCH FIRST, because "stop chasing this one" is the reason a
              pilot opens this panel in a hurry. */}
          <Flex align="center" gap="2" mb="3">
            <Switch
              checked={!suppressed}
              disabled={pending}
              onCheckedChange={(value) => {
                const next = value !== true;
                setSuppressed(next);
                startTransition(async () => {
                  setError(null);
                  const result = await setInvoiceRemindersSuppressed(invoiceId, next);
                  if (result.error) {
                    // Put it back: the screen must not show a state the
                    // database refused.
                    setSuppressed(!next);
                    setError(result.error);
                  }
                });
              }}
            />
            <Text size="2">
              {suppressed
                ? "Paused — no scheduled reminder will go out for this invoice."
                : `Follow ${clientName}'s schedule for this invoice.`}
            </Text>
          </Flex>

          {!canEmail ? (
            <Text as="div" size="1" color="amber" mb="2">
              Emailing isn&rsquo;t set up on this account yet, so scheduled
              reminders can&rsquo;t be sent. Nothing is marked as sent, and
              anything due will go out once it is.
            </Text>
          ) : !clientHasEmail ? (
            <Text as="div" size="1" color="amber" mb="2">
              {clientName} has no email address on file, so nothing can be sent.
              Add one on their page.
            </Text>
          ) : null}

          <Flex direction="column" gap="2">
            {rungs.map((rung) => (
              <Flex key={rung.key} justify="between" align="start" gap="3">
                <Flex direction="column">
                  <Text size="2">{rung.label}</Text>
                  <Text size="1" color="gray">
                    {rung.when}
                    {rung.at ? ` · ${rung.at}` : ""}
                  </Text>
                  {rung.detail ? (
                    <Text size="1" color={rung.state === "failed" ? "red" : "gray"}>
                      {rung.detail}
                    </Text>
                  ) : null}
                </Flex>
                <Badge color={STATE_COLOR[rung.state]}>{STATE_LABEL[rung.state]}</Badge>
              </Flex>
            ))}
          </Flex>

          {hold ? (
            <Text as="div" size="1" color="gray" mt="3">
              {hold}
            </Text>
          ) : nextUp ? (
            <Text as="div" size="1" color="gray" mt="3">
              {nextUp}
            </Text>
          ) : null}
        </>
      )}

      {manualSends.length > 0 ? (
        <Box mt="3">
          <Text as="div" size="1" color="gray">
            Sent by hand: {manualSends.join(", ")}
          </Text>
        </Box>
      ) : null}

      {/* ------------------------------------------------------------------
          THE LATE FEE. Shown only when the pilot has agreed one with this
          client — there is no "set up a late fee" prompt here, deliberately.
          A product that suggests charging somebody's client extra is making a
          commercial decision it has no standing to make.
          ------------------------------------------------------------------ */}
      {lateFee.policy ? (
        <>
          <Separator size="4" my="4" />
          <Text as="div" size="2" weight="medium" mb="1">
            Late fee
          </Text>
          <Text as="div" size="1" color="gray">
            {lateFee.policy}
          </Text>

          {lateFee.raised.length > 0 ? (
            <Box mt="2">
              {lateFee.raised.map((fee) => (
                <Text as="div" size="1" color="gray" key={fee.id}>
                  {fee.amount} raised {fee.when} —{" "}
                  <RadixLink asChild>
                    <NextLink href={`/invoices/${fee.id}`}>
                      {fee.number ?? "draft invoice"}
                    </NextLink>
                  </RadixLink>
                </Text>
              ))}
            </Box>
          ) : null}

          {lateFee.quote ? (
            <Box mt="3">
              <Text as="div" size="2" mb="2">
                {lateFee.quote}
              </Text>
              <AlertDialog.Root>
                <AlertDialog.Trigger>
                  <Button variant="outline" disabled={pending} style={{ width: "100%" }}>
                    Draft a late fee invoice
                  </Button>
                </AlertDialog.Trigger>
                <AlertDialog.Content maxWidth="440px">
                  <AlertDialog.Title>
                    Draft a late fee invoice for {clientName}?
                  </AlertDialog.Title>
                  {/* SPELLS OUT EVERY CONSEQUENCE, because this is the one
                      action in the feature that creates a billable document.
                      It says what it makes (a draft), what it does not touch
                      (this invoice), and who sends it (them). */}
                  <AlertDialog.Description size="2">
                    This creates a SEPARATE draft invoice for {lateFee.quote} — it
                    does not change this invoice, which stays exactly as your
                    client received it. Nothing is sent: you review the draft and
                    send it yourself, like any other invoice. Only do this if the
                    fee is in what you agreed with them.
                  </AlertDialog.Description>
                  <Flex gap="3" mt="4" justify="end">
                    <AlertDialog.Cancel>
                      <Button variant="soft" color="gray">
                        Cancel
                      </Button>
                    </AlertDialog.Cancel>
                    <AlertDialog.Action>
                      <Button
                        variant="solid"
                        onClick={() => {
                          startTransition(async () => {
                            setError(null);
                            const result = await createLateFeeInvoice(invoiceId);
                            // On success this redirects to the new draft and
                            // never returns a value.
                            setError(result?.error ?? null);
                          });
                        }}
                      >
                        Create the draft
                      </Button>
                    </AlertDialog.Action>
                  </Flex>
                </AlertDialog.Content>
              </AlertDialog.Root>
            </Box>
          ) : (
            <Text as="div" size="1" color="gray" mt="2">
              Nothing to charge yet.
            </Text>
          )}
        </>
      ) : null}

      {error ? (
        <Box mt="3" role="alert">
          <Text size="1" color="red">
            {error}
          </Text>
        </Box>
      ) : null}
    </Card>
  );
}

const STATE_LABEL: Record<ReminderRungView["state"], string> = {
  sent: "Sent",
  failed: "Failed",
  skipped: "Skipped",
  upcoming: "Scheduled",
};

const STATE_COLOR: Record<ReminderRungView["state"], "green" | "red" | "gray" | "blue"> = {
  sent: "green",
  failed: "red",
  skipped: "gray",
  upcoming: "blue",
};
