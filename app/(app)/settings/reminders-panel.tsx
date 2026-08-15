"use client";

import { useState, useTransition } from "react";
import NextLink from "next/link";
import {
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Link as RadixLink,
  Separator,
  Text,
} from "@/components/ui";
import { runDueRemindersNow } from "../invoices/reminder-actions";

/**
 * WHERE A PILOT FINDS OUT WHETHER THE THING THAT SENDS MAIL IS ACTUALLY
 * RUNNING.
 *
 * supabase/migrations/20260809030000's refusal to build a background job
 * named the failure this panel has to answer for: "a job silently not firing
 * for a week is invisible until a client complains." Three things make that
 * answerable rather than a promise —
 *
 *   1. LAST RUN is a real timestamp from pilot.accounts.reminders_last_run_at,
 *      written at the end of every pass. "Never" is shown as never.
 *   2. THE TWO SWITCHES ARE NAMED. A deployment with no CRON_SECRET has no
 *      scheduler at all, and one with no mail service cannot send; both are
 *      stated as facts about this deployment rather than left to be inferred
 *      from nothing happening.
 *   3. RUN NOW does the identical pass by hand, and reports what it did AND
 *      what it could not do. That is also what makes the feature usable before
 *      any scheduler exists — the same floor the recurring-invoices due queue
 *      set.
 */
export default function RemindersPanel({
  schedulerConfigured,
  mailConfigured,
  lastRunAt,
  clientsWithSchedules,
  clientsTotal,
  clientsLoadFailed,
}: {
  /** CRON_SECRET is set on this deployment — resolved server-side. */
  schedulerConfigured: boolean;
  /** RESEND_API_KEY + INVOICE_FROM_EMAIL are set. */
  mailConfigured: boolean;
  /** Already formatted, or null for never. */
  lastRunAt: string | null;
  clientsWithSchedules: { id: string; name: string; summary: string }[];
  clientsTotal: number;
  /**
   * The client read failed, so this list is not an answer.
   *
   * Without it an outage renders as "none of your 0 clients has a schedule, so
   * nothing is sent automatically" — a positive claim about who this product
   * writes to, made from no data, on the one screen a pilot opens to audit
   * exactly that. Not knowing has to look different from knowing nobody.
   */
  clientsLoadFailed: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [lines, setLines] = useState<string[] | null>(null);

  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="1">
        <Heading as="h3" size="4">
          Reminders
        </Heading>
      </Flex>

      <Card>
        <Flex direction="column" gap="3" p="1">
          <Flex direction="column" gap="1">
            <Text size="2" weight="medium">
              On this deployment
            </Text>
            <Text as="div" size="2" color={schedulerConfigured ? "gray" : "amber"}>
              {schedulerConfigured
                ? "The daily run is switched on."
                : "The daily run is switched off. Nothing goes out on its own until CRON_SECRET is set on the deployment. You can still run it by hand below."}
            </Text>
            <Text as="div" size="2" color={mailConfigured ? "gray" : "amber"}>
              {mailConfigured
                ? "Emailing is set up."
                : "Emailing isn't set up, so nothing can be sent. A run will still tell you exactly what was due, and nothing gets marked as sent."}
            </Text>
            <Text as="div" size="2" color="gray">
              {lastRunAt ? `Last run ${lastRunAt}.` : "It has never run for this account."}
            </Text>
          </Flex>

          <Separator size="4" />

          <Flex direction="column" gap="1">
            <Text size="2" weight="medium">
              Who gets reminders
            </Text>
            {clientsLoadFailed ? (
              <Text as="div" size="2" color="amber">
                Your client schedules couldn&rsquo;t be loaded just now, so this
                list may be incomplete. It is not a sign that nothing is
                scheduled. Reload the page to try again; the daily run is
                unaffected either way.
              </Text>
            ) : clientsWithSchedules.length === 0 ? (
              <Text as="div" size="2" color="gray">
                None of your {clientsTotal} client
                {clientsTotal === 1 ? "" : "s"} has a schedule, so nothing is
                sent automatically. You set one on a client&rsquo;s own page.
              </Text>
            ) : (
              <Flex direction="column" gap="1">
                {clientsWithSchedules.map((client) => (
                  <Text as="div" size="2" key={client.id}>
                    <RadixLink asChild>
                      <NextLink href={`/clients/${client.id}`}>{client.name}</NextLink>
                    </RadixLink>{" "}
                    <Text as="span" size="1" color="gray">
                      · {client.summary}
                    </Text>
                  </Text>
                ))}
              </Flex>
            )}
          </Flex>

          <Separator size="4" />

          <Flex direction="column" gap="2">
            <Flex>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    setLines(null);
                    const result = await runDueRemindersNow();
                    setLines(result.error ? [result.error] : (result.lines ?? []));
                  });
                }}
              >
                {pending ? "Running…" : "Run due reminders now"}
              </Button>
            </Flex>
            {/* NAMES THE CONSEQUENCE BEFORE THE PRESS. This button can put mail
                in somebody's client's inbox, so it must not read like a
                refresh. */}
            <Text size="1" color="gray">
              Sends anything that is due right now, exactly as the daily run
              would. Safe to press twice: a reminder that has already gone out
              is never sent again.
            </Text>
            {lines ? (
              <Box role="status">
                {lines.map((line, index) => (
                  <Text as="div" size="1" color="gray" key={`${index}-${line.slice(0, 24)}`}>
                    {line}
                  </Text>
                ))}
              </Box>
            ) : null}
          </Flex>
        </Flex>
      </Card>
    </Flex>
  );
}
