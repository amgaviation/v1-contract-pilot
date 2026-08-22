import "server-only";
import { alertOperator } from "@/lib/alerts";
import { accountIsReadOnly, isEntitled, isPlanTier } from "@/lib/entitlements";
import { idChunks } from "@/lib/id-chunks";
import { issueAndChargeAutopayInvoice } from "@/lib/autopay/charge";
import { computeDuePeriods } from "@/app/(app)/invoices/recurring/actions";

/**
 * THE UNATTENDED AUTOPAY PASS — what finally makes "autopay" automatic.
 *
 * Until this existed the whole chain (compute due periods, generate the
 * draft, issue it, charge the saved card) only fired when the pilot was
 * signed in and clicked "Create all due". A pilot who enabled autopay and
 * then flew for two weeks collected nothing in that window and was never
 * told. For a contract pilot who may be unreachable for days, that is the
 * opposite of what the feature name promises.
 *
 * ── WHY THIS COULD NOT SIMPLY CALL THE EXISTING SERVER ACTION ────────────
 *
 * pilot.generate_recurring_invoice authorizes with
 * `account_id in (select pilot.current_account_ids())`, which resolves
 * through auth.uid(). Outside a PostgREST request carrying a user JWT there
 * is no auth.uid(), so that predicate matches nothing for every account —
 * it does not fail loudly, it reports "not found" for everything. It is
 * also granted to `authenticated` only. 20260819100000 added
 * pilot.generate_autopay_invoice for exactly this caller: explicit account
 * parameter, granted to service_role, and re-deriving five preconditions
 * from the rows rather than trusting this pass's WHERE clause.
 *
 * ── WHAT STOPS THIS CHARGING SOMEONE IT SHOULD NOT ───────────────────────
 *
 * Three independent layers, in the order they apply:
 *
 *   1. THE SELECT below, which asks only for accounts that can be written
 *      to at all.
 *   2. THE ENTITLEMENT RE-CHECK per account, in code, using the SAME pure
 *      functions the interactive path's requireEntitlement uses
 *      (accountIsReadOnly, isEntitled) rather than a hand-rolled copy of
 *      their rules. The SELECT and this check are deliberately redundant:
 *      the SELECT is an optimisation, this is the decision.
 *   3. THE DATABASE FUNCTION, which refuses a schedule that is not the
 *      account's, not active, not autopay-enabled, whose client holds no
 *      consent record, or whose period has not started. A bug in either
 *      layer above still cannot produce a charge it forbids.
 *
 * READ-ONLY IS STRICTER HERE THAN FOR REMINDERS, and the difference is
 * load-bearing. runAllDueReminders selects status in
 * (trialing, active, past_due) — chasing an unpaid invoice is still right
 * for a tenant whose own card just failed. Autopay is not: past_due is
 * absent from ACCOUNT_WRITABLE_STATUSES, so accountIsReadOnly() is true for
 * it, and creating and charging an invoice on a lapsed account is exactly
 * the write that gate exists to refuse. A hold and a deactivation are
 * refused for the same reason and by the same function.
 *
 * ── IDEMPOTENCY: WHY A RETRY CANNOT DOUBLE-BILL ──────────────────────────
 *
 * Not reimplemented here. pilot.generate_autopay_invoice's three writes are
 * one statement's effects, and the last takes the unique
 * (account_id, schedule_id, period_start) on
 * pilot.recurring_invoice_generations. A cron retry, two overlapping
 * passes, or this pass racing the pilot's own click on the interactive path
 * all land on that row: the loser raises 23505 and the invoice and line it
 * had already inserted roll back with it. THIS PASS TREATS 23505 AS A
 * NORMAL, SILENT OUTCOME for that reason — it means somebody else generated
 * the period first, which is success, not an error worth waking anyone for.
 *
 * The window that idempotency does NOT cover is between a successful
 * generation and its charge: if the process dies there, the invoice exists
 * and is issued but unpaid. That is recoverable and visible (it is a real
 * invoice on the pilot's own screen) and is deliberately preferred to the
 * alternative, which is charging before the record exists.
 *
 * ── SEQUENTIAL, AND WHAT THAT COSTS ──────────────────────────────────────
 *
 * Same shape and same reasoning as the reminders pass it runs beside: one
 * account at a time, each wrapped so a single tenant cannot end the pass for
 * everyone after it in the iteration order. This adds work to an invocation
 * that already has a 300s ceiling; at the stated scale (hundreds of
 * accounts, few with autopay) the addition is small, but it is real, and
 * lib/reminders/run.ts's own note about sharding before ~100-150 reminder-
 * enabled accounts now covers this pass too.
 *
 * ── THE TWO READS ARE BATCHED; THE WRITES ARE NOT ────────────────────────
 *
 * The pass used to be three levels of sequential round trips: one
 * recurring_invoice_schedules read per account, then one
 * recurring_invoice_generations read per schedule, then the RPC. The two
 * reads are now done up front, in chunks, across every eligible account —
 * they are pure reads with no side effects and no ordering significance, so
 * hoisting them changes nothing about WHICH periods are found, only how many
 * requests find them. Everything that writes — generate_autopay_invoice and
 * the charge — is deliberately untouched: still one account at a time, one
 * schedule at a time, oldest period first, inside the same per-account
 * try/catch. Batching those would put two tenants' money in one failure
 * domain, which is the exact thing the loop below is built to prevent, and
 * the (account_id, schedule_id, period_start) idempotency unique is written
 * per statement anyway.
 *
 * ISOLATION IS PRESERVED BY FALLING BACK, NOT BY TRUSTING THE BATCH. A
 * batched read that errors, throws, or comes back truncated does NOT fail
 * the accounts it covered: those accounts are simply left unbatched, and the
 * loop below reads them exactly the way it always did — per account, per
 * schedule, inside the try, with the same message and the same
 * alertOperator call. The worst case of a bad batch is today's behaviour and
 * today's alerts, never a new one, and never one account's read failure
 * deciding another account's fate.
 *
 * TRUNCATION IS CHECKED, NOT ASSUMED. PostgREST caps rows per response, and
 * a cap silently applied to a batched read is worse than an error: it looks
 * like "this account has no schedules due", i.e. it does not bill someone
 * and says nothing. Every batched read therefore asks for `count: "exact"`
 * and compares it to the rows it actually received; a mismatch discards the
 * chunk and hands those accounts to the per-account path.
 */

export type AutopayRunSummary = {
  accountsConsidered: number;
  accountsSkipped: number;
  generated: number;
  charged: number;
  issuedNotCharged: number;
  notIssued: number;
  alreadyGenerated: number;
  refusedByDatabase: number;
  errors: string[];
  notices: string[];
};

function emptySummary(): AutopayRunSummary {
  return {
    accountsConsidered: 0,
    accountsSkipped: 0,
    generated: 0,
    charged: 0,
    issuedNotCharged: 0,
    notIssued: 0,
    alreadyGenerated: 0,
    refusedByDatabase: 0,
    errors: [],
    notices: [],
  };
}

/** Today as YYYY-MM-DD in UTC — the same shape computeDuePeriods compares against. */
function todayYmd(now: Date): string {
  return now.toISOString().slice(0, 10);
}

type AccountRow = {
  id: string;
  status: string;
  plan_tier: string | null;
  deactivated_at: string | null;
  hold_started_at: string | null;
  connect_account_id: string | null;
};

type ScheduleRow = {
  id: string;
  client_id: string;
  cadence: string;
  anchor_date: string;
  end_date: string | null;
};

type BatchedScheduleRow = ScheduleRow & { account_id: string };

/**
 * Layer 2's decision, extracted so the batched pre-pass and the loop ask the
 * same question of the same pure functions. The loop still asks it itself —
 * it has two different counters to bump — so this is only ever used to
 * decide whose ids are worth putting in a batched read. Answering it wrongly
 * here can cost a round trip; it cannot admit an account the loop rejects.
 */
function isEligibleForUnattendedAutopay(account: AccountRow): boolean {
  if (accountIsReadOnly(account)) return false;
  const tier = account.plan_tier;
  return isPlanTier(tier) && isEntitled(tier, "recurring_invoices");
}

/** The key both batched maps are grouped by. Account-scoped on purpose: a
 * schedule id is a uuid primary key, but the per-schedule read this replaces
 * filtered on account_id AND schedule_id, and dropping half of a composite
 * scope because "the other half is unique anyway" is how a tenancy bug gets
 * in. A row that arrives under another account's id simply never matches. */
function scopedKey(accountId: string, scheduleId: string): string {
  return `${accountId}:${scheduleId}`;
}

export async function runAllDueAutopay(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceClient: any,
  options: { now?: Date } = {}
): Promise<AutopayRunSummary> {
  const summary = emptySummary();
  const now = options.now ?? new Date();
  const today = todayYmd(now);

  // Layer 1. Deliberately narrower than the reminders pass — see the header.
  const { data, error } = await serviceClient
    .from("accounts")
    .select("id, status, plan_tier, deactivated_at, hold_started_at, connect_account_id")
    .in("status", ["trialing", "active"])
    .is("deactivated_at", null)
    .is("hold_started_at", null);

  if (error) {
    summary.errors.push(`Autopay pass: accounts.select failed: ${error.message}`);
    await alertOperator({
      source: "autopay-cron",
      summary: "Autopay pass: accounts.select failed, no accounts processed",
      detail: error.message,
    });
    return summary;
  }

  const accounts = (data ?? []) as AccountRow[];

  // ── PRE-PASS: the two reads, batched ────────────────────────────────────
  //
  // Nothing here decides anything. It fills two lookups; every account whose
  // lookup is missing or untrustworthy falls through to the per-account read
  // it always used, inside its own try/catch, unchanged.

  const eligibleAccountIds = accounts
    .filter((account) => isEligibleForUnattendedAutopay(account))
    .map((account) => account.id);

  /** account id → its active, autopay-enabled schedules. */
  const schedulesByAccount = new Map<string, ScheduleRow[]>();
  /** Account ids whose schedules were read in bulk AND came back whole. Membership,
   *  not `schedulesByAccount.has()`, is what says "trust the map" — an account with
   *  no schedules at all is a successful empty read, not a missing one. */
  const schedulesBatched = new Set<string>();

  for (const chunk of idChunks(eligibleAccountIds)) {
    try {
      const {
        data: chunkData,
        error: chunkError,
        count,
      } = await serviceClient
        .from("recurring_invoice_schedules")
        .select("id, account_id, client_id, cadence, anchor_date, end_date", {
          count: "exact",
        })
        .in("account_id", chunk)
        .eq("active", true)
        .eq("autopay", true);

      const rows = (chunkData ?? []) as BatchedScheduleRow[];
      if (chunkError || (typeof count === "number" && count !== rows.length)) {
        summary.notices.push(
          `Autopay pass: a batched schedule read covering ${chunk.length} account(s) was not usable (${
            chunkError ? chunkError.message : `truncated: ${count} row(s) matched, ${rows.length} returned`
          }); those accounts were read one at a time instead.`
        );
        continue;
      }

      const asked = new Set(chunk);
      const grouped = new Map<string, ScheduleRow[]>();
      for (const row of rows) {
        // Belt and braces: only rows for the accounts this chunk asked about.
        if (!asked.has(row.account_id)) continue;
        const list = grouped.get(row.account_id) ?? [];
        list.push({
          id: row.id,
          client_id: row.client_id,
          cadence: row.cadence,
          anchor_date: row.anchor_date,
          end_date: row.end_date,
        });
        grouped.set(row.account_id, list);
      }
      for (const accountId of chunk) {
        schedulesByAccount.set(accountId, grouped.get(accountId) ?? []);
        schedulesBatched.add(accountId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      summary.notices.push(
        `Autopay pass: a batched schedule read threw (${message}); those accounts were read one at a time instead.`
      );
    }
  }

  /** `${account_id}:${schedule_id}` → the period_starts already generated. */
  const generationsBySchedule = new Map<string, Set<string>>();
  /** The same "trust the map" set, per schedule, for the same reason. */
  const generationsBatched = new Set<string>();

  const batchedScheduleIds: string[] = [];
  const scheduleOwner = new Map<string, string>();
  for (const accountId of schedulesBatched) {
    for (const schedule of schedulesByAccount.get(accountId) ?? []) {
      batchedScheduleIds.push(schedule.id);
      scheduleOwner.set(schedule.id, accountId);
    }
  }

  for (const chunk of idChunks(batchedScheduleIds)) {
    try {
      const {
        data: chunkData,
        error: chunkError,
        count,
      } = await serviceClient
        .from("recurring_invoice_generations")
        .select("account_id, schedule_id, period_start", { count: "exact" })
        .in("schedule_id", chunk);

      const rows = (chunkData ?? []) as {
        account_id: string;
        schedule_id: string;
        period_start: string;
      }[];
      if (chunkError || (typeof count === "number" && count !== rows.length)) {
        summary.notices.push(
          `Autopay pass: a batched generation-ledger read covering ${chunk.length} schedule(s) was not usable (${
            chunkError ? chunkError.message : `truncated: ${count} row(s) matched, ${rows.length} returned`
          }); those schedules were read one at a time instead.`
        );
        continue;
      }

      for (const row of rows) {
        // The account scope the per-schedule read applied, applied here.
        if (scheduleOwner.get(row.schedule_id) !== row.account_id) continue;
        const key = scopedKey(row.account_id, row.schedule_id);
        const periods = generationsBySchedule.get(key) ?? new Set<string>();
        periods.add(row.period_start);
        generationsBySchedule.set(key, periods);
      }
      for (const scheduleId of chunk) {
        const accountId = scheduleOwner.get(scheduleId);
        if (accountId) generationsBatched.add(scopedKey(accountId, scheduleId));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      summary.notices.push(
        `Autopay pass: a batched generation-ledger read threw (${message}); those schedules were read one at a time instead.`
      );
    }
  }

  for (const account of accounts) {
    // ONE TENANT CANNOT END THE PASS. Identical isolation to the reminders
    // loop, and for the identical reason: accounts iterate in a fixed order,
    // so an exception escaping here would strand every tenant after this one
    // every single day.
    try {
      // Layer 2. The decision, made with the same pure functions the
      // interactive path uses rather than a second copy of their rules.
      if (accountIsReadOnly(account)) {
        summary.accountsSkipped += 1;
        continue;
      }
      const tier = account.plan_tier;
      if (!isPlanTier(tier) || !isEntitled(tier, "recurring_invoices")) {
        summary.accountsSkipped += 1;
        continue;
      }
      summary.accountsConsidered += 1;

      // Batched above when it could be; read here, exactly as it always was,
      // when it could not. The failure path below is the pre-batch one
      // verbatim — same message, same alert, same "skip this account, the
      // rest of the pass continues".
      let schedules: ScheduleRow[];
      if (schedulesBatched.has(account.id)) {
        schedules = schedulesByAccount.get(account.id) ?? [];
      } else {
        const { data: schedData, error: schedError } = await serviceClient
          .from("recurring_invoice_schedules")
          .select("id, client_id, cadence, anchor_date, end_date")
          .eq("account_id", account.id)
          .eq("active", true)
          .eq("autopay", true);
        if (schedError) {
          summary.errors.push(
            `Autopay pass: could not read schedules for one account: ${schedError.message}`
          );
          await alertOperator({
            source: "autopay-cron",
            summary: "Autopay pass: recurring_invoice_schedules.select failed for an account",
            detail: schedError.message,
            accountId: account.id,
          });
          continue;
        }
        schedules = (schedData ?? []) as ScheduleRow[];
      }
      if (schedules.length === 0) continue;

      for (const schedule of schedules) {
        // Same arrangement as the schedules above: the batched answer when
        // there is a trustworthy one, otherwise the original per-schedule
        // read with its original failure behaviour.
        let generated: Set<string>;
        const generationsKey = scopedKey(account.id, schedule.id);
        if (generationsBatched.has(generationsKey)) {
          generated = generationsBySchedule.get(generationsKey) ?? new Set<string>();
        } else {
          const { data: genData, error: genError } = await serviceClient
            .from("recurring_invoice_generations")
            .select("period_start")
            .eq("account_id", account.id)
            .eq("schedule_id", schedule.id);
          if (genError) {
            summary.errors.push(
              `Autopay pass: could not read the generation ledger for one schedule: ${genError.message}`
            );
            await alertOperator({
              source: "autopay-cron",
              summary: "Autopay pass: recurring_invoice_generations.select failed",
              detail: `schedule ${schedule.id}: ${genError.message}`,
              accountId: account.id,
            });
            continue;
          }
          generated = new Set(
            ((genData ?? []) as { period_start: string }[]).map((r) => r.period_start)
          );
        }

        // The SAME due-period arithmetic the interactive queue uses. Pure
        // date math, imported rather than reimplemented — a second
        // implementation of "which periods are due" is a second answer, and
        // the two would eventually disagree about a month boundary.
        const due = await computeDuePeriods(
          {
            id: schedule.id,
            cadence: schedule.cadence as ScheduleRow["cadence"],
            anchor_date: schedule.anchor_date,
            end_date: schedule.end_date,
          } as never,
          generated,
          today
        );

        // SEQUENTIAL PER PERIOD, oldest first, so a schedule catching up on a
        // backlog bills the months in the order they happened.
        for (const period of due) {
          const { data: newInvoiceId, error: rpcError } = await serviceClient.rpc(
            "generate_autopay_invoice",
            {
              target_account: account.id,
              p_schedule_id: schedule.id,
              p_period_start: period.period_start,
            } as never
          );

          if (rpcError) {
            // 23505 — somebody else already generated this exact period. The
            // idempotency guarantee working as designed, not a failure.
            if (rpcError.code === "23505") {
              summary.alreadyGenerated += 1;
              continue;
            }
            // 42501 — the grant is missing or broken. The mechanism cannot
            // run at all, and every remaining period will fail identically.
            // This is the pilot.expire_hold defect's failure mode, which
            // hid for a whole release because the caller could not tell it
            // apart from a business refusal. It is not folded in here.
            if (rpcError.code === "42501") {
              summary.errors.push(
                "Autopay pass: generate_autopay_invoice was denied (42501, insufficient_privilege). The EXECUTE grant is missing or broken; nothing further was attempted."
              );
              await alertOperator({
                source: "autopay-cron",
                summary:
                  "Autopay pass: generate_autopay_invoice denied with 42501 — the grant is broken, not a business refusal",
                detail: `schedule ${schedule.id}, period ${period.period_start}: ${rpcError.message}`,
                accountId: account.id,
              });
              return summary;
            }
            // P0001 / P0002 — the function re-derived a precondition and
            // said no (paused, autopay off, client not enrolled, future
            // period, not this account's). Expected, and the reason this
            // pass is allowed to be simple.
            summary.refusedByDatabase += 1;
            summary.notices.push(
              `A due autopay period was refused by the database: ${rpcError.message}`
            );
            continue;
          }

          const invoiceId = newInvoiceId as string | null;
          if (!invoiceId) {
            summary.errors.push(
              "Autopay pass: generation returned no invoice id, so nothing was issued or charged."
            );
            continue;
          }
          summary.generated += 1;

          const outcome = await issueAndChargeAutopayInvoice(
            serviceClient,
            { id: account.id, connectAccountId: account.connect_account_id },
            schedule.client_id,
            invoiceId
          );

          if (outcome.kind === "charged") {
            summary.charged += 1;
            summary.notices.push(outcome.message);
          } else if (outcome.kind === "issued_not_charged") {
            // A REAL, OUTSTANDING INVOICE THAT DID NOT GET PAID. The pilot
            // cannot see this happen — nobody was here — so it is the one
            // outcome that alerts rather than only counting.
            summary.issuedNotCharged += 1;
            summary.notices.push(outcome.message);
            await alertOperator({
              source: "autopay-cron",
              summary: "Autopay charge failed on an invoice that was already issued",
              detail: `${outcome.message} (invoice ${invoiceId}, schedule ${schedule.id}, period ${period.period_start})`,
              accountId: account.id,
            });
          } else {
            // Left as a draft. Nothing was issued and nothing was charged;
            // the pilot has a draft waiting, which is the designed fallback.
            summary.notIssued += 1;
            summary.notices.push(outcome.message);
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      summary.errors.push(
        `One account's autopay pass could not be completed: ${message}. The rest of the pass continued.`
      );
      console.error(`[autopay] account ${account.id} threw during the pass: ${message}`);
      await alertOperator({
        source: "autopay-cron",
        summary: "Autopay pass: an account's pass threw an unexpected exception",
        detail: `account ${account.id}: ${message}`,
        accountId: account.id,
      });
    }
  }

  return summary;
}
