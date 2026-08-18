"use client";

import { useState, useTransition } from "react";
import NextLink from "next/link";
import { LButton, LCard, LSeparator } from "@/components/ledger";
import { cn } from "@/lib/ledger/cn";
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
    <div className="flex flex-col gap-4">
      <h3 className="text-h3 font-semibold text-ink">Reminders</h3>

      <LCard>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-body-s font-medium text-ink">On this deployment</p>
            <p className={cn("text-body-s", schedulerConfigured ? "text-ink-2" : "text-warn")}>
              {schedulerConfigured
                ? "The daily run is switched on."
                : "The daily run is off for this deployment. Nothing sends on its own, but you can run it by hand below."}
            </p>
            <p className={cn("text-body-s", mailConfigured ? "text-ink-2" : "text-warn")}>
              {mailConfigured
                ? "Emailing is set up."
                : "Emailing isn't set up, so nothing sends. A run still shows what was due, and marks nothing as sent."}
            </p>
            <p className="text-body-s text-ink-2">
              {lastRunAt ? `Last run ${lastRunAt}.` : "It has never run for this account."}
            </p>
          </div>

          <LSeparator />

          <div className="flex flex-col gap-1">
            <p className="text-body-s font-medium text-ink">Who gets reminders</p>
            {clientsLoadFailed ? (
              <p className="text-body-s text-warn">
                Your client schedules couldn&rsquo;t be loaded just now, so this
                list may be incomplete. It is not a sign that nothing is
                scheduled. Reload the page to try again; the daily run is
                unaffected either way.
              </p>
            ) : clientsWithSchedules.length === 0 ? (
              <p className="text-body-s text-ink-2">
                None of your {clientsTotal} client
                {clientsTotal === 1 ? "" : "s"} has a schedule, so nothing is
                sent automatically. You set one on a client&rsquo;s own page.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {clientsWithSchedules.map((client) => (
                  <p className="text-body-s text-ink" key={client.id}>
                    <NextLink
                      href={`/clients/${client.id}`}
                      className="font-medium text-accent underline-offset-2 hover:underline"
                    >
                      {client.name}
                    </NextLink>{" "}
                    <span className="text-caption text-ink-3">· {client.summary}</span>
                  </p>
                ))}
              </div>
            )}
          </div>

          <LSeparator />

          <div className="flex flex-col gap-2">
            <div>
              <LButton
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
              </LButton>
            </div>
            {/* NAMES THE CONSEQUENCE BEFORE THE PRESS. This button can put mail
                in somebody's client's inbox, so it must not read like a
                refresh. */}
            <p className="text-caption text-ink-3">
              Sends whatever is due now, exactly as the daily run would.
              Pressing twice is safe: a sent reminder is never re-sent. A
              confirmed failure retries on later runs; an unconfirmed send
              never does, so that one stays your call.
            </p>
            {lines ? (
              <div role="status">
                {lines.map((line, index) => (
                  <p className="text-caption text-ink-3" key={`${index}-${line.slice(0, 24)}`}>
                    {line}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </LCard>
    </div>
  );
}
