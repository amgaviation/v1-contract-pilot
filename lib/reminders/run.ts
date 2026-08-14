import "server-only";
import { sendInvoiceEmail } from "@/lib/email/send-invoice";
import { emailIsConfigured, looksLikeEmail } from "@/lib/email/send";
import { friendlyDbError } from "@/lib/db-errors";
import {
  decideReminder,
  describeHold,
  normalizeReminderPolicy,
  reminderPolicyIsEmpty,
  toCalendarDate,
  type Rung,
} from "./policy";

/**
 * THE DUE-REMINDER PASS: the one piece of this product that sends mail with
 * nobody logged in.
 *
 * Read supabase/migrations/20260813130000's header before changing anything
 * here — it carries the argument for why a scheduled reminder is allowed at
 * all when 20260809030000 refused a scheduled INVOICE, and the two halves of
 * that argument are conditions on this file: a reminder creates no document
 * and moves no status, and every attempt is recorded with its true outcome.
 *
 * THE SAME CODE RUNS FROM BOTH ENTRY POINTS, with different clients:
 *
 *   * the daily cron route (app/api/reminders/run/route.ts) passes a
 *     SERVICE-ROLE client, because there is no session to run as, and loops
 *     every account;
 *   * the "Run due reminders now" button in Settings passes the pilot's own
 *     SESSION client for their own account, where RLS is the boundary exactly
 *     as it is everywhere else in the app.
 *
 * Taking the client as a parameter rather than reaching for the service-role
 * client internally is what keeps the second path honest: a pilot pressing a
 * button in their own account never runs with RLS switched off, and the
 * privileged client's caller set stays exactly as small as
 * lib/supabase/service-role.ts says it is.
 *
 * NOTHING HERE THROWS, and that is enforced rather than intended: the
 * per-invoice body and each account's pass are both wrapped in try/catch. A
 * failure on one invoice must not abandon the rest of the account, and a
 * failure on one account must not abandon the pass — the "silently not firing"
 * failure mode this feature owes an answer to is precisely the shape a single
 * unhandled rejection would produce, and it would produce it at the same point
 * every day, for every tenant after the poisoned one, forever.
 */

/** What could not even be attempted, and why. Written nowhere — see below. */
export type ReminderBlocked = {
  invoiceId: string;
  invoiceNumber: string | null;
  clientName: string;
  reason: string;
};

export type ReminderRunSummary = {
  invoicesConsidered: number;
  sent: number;
  failed: number;
  skipped: number;
  /**
   * Conditions that stopped a send today and will simply be re-evaluated
   * tomorrow: the mail service unconfigured, a client with no address, a
   * quiet period after a manual chase.
   *
   * THESE WRITE NO LEDGER ROW, deliberately. A ledger row consumes the rung
   * forever, and "you have not added Meridian's email address yet" must not
   * cost the pilot a chase the moment they add it. They are derived facts,
   * true again tomorrow, so they are reported here and rendered on screen
   * from live data — the same rule this schema has held since Phase 5, where
   * overdue is a view and never a stored flag.
   */
  blocked: ReminderBlocked[];
  /** Read failures. Reported, never swallowed, never fatal. */
  errors: string[];
  /**
   * Ordinary, non-failure things a pass wants to say — today only the overlap
   * stand-down.
   *
   * SEPARATE FROM `errors` ON PURPOSE. The cron route logs `errors.length` as
   * "read error(s)", and anything watching that endpoint reads a non-zero
   * count as something to investigate. A pass that correctly declined to run
   * because another one was already running is a no-op, not a fault, and
   * filing it under errors makes a routine event indistinguishable from a
   * database failure on the one dial an operator has.
   */
  notices: string[];
};

const EMPTY_SUMMARY: ReminderRunSummary = {
  invoicesConsidered: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
  blocked: [],
  errors: [],
  notices: [],
};

/** A fresh summary — never a shared reference to EMPTY_SUMMARY's arrays. */
function emptySummary(): ReminderRunSummary {
  return { ...EMPTY_SUMMARY, blocked: [], errors: [], notices: [] };
}

/**
 * How many invoices one account is allowed to consume in one pass.
 *
 * A serverless invocation has a wall clock, and every send renders a PDF. A
 * cap means a pathological account degrades to "the rest go tomorrow"
 * (visible: the summary says so) rather than to a timeout partway through
 * with no record of where it stopped. Well above any real contract pilot's
 * open receivables.
 */
const MAX_INVOICES_PER_ACCOUNT = 100;

/**
 * How recently a pass must have started for this one to stand down.
 *
 * The unique index on pilot.invoice_reminder_sends stops two overlapping runs
 * from recording the same rung twice; it cannot stop them both DECIDING to
 * send before either records. So the watermark is CLAIMED AT THE START of a
 * pass, by a conditional update that only one of two racing passes can win —
 * see claimRun. Stamping it only at the end (which is what this did first)
 * left the entire duration of a pass unprotected, and a pass is exactly where
 * the time goes: a PDF render and a ten-second mail timeout per send. "Press
 * Run now just after setup, while the daily cron happens to fire" is the
 * likely collision, not an unlikely one.
 */
const RUN_COOLDOWN_MINUTES = 10;

type ClientRow = {
  id: string;
  name: string;
  contact_email: string | null;
  // The AP/accounting inbox sendInvoiceEmail actually sends to when it looks
  // like a real address (20260814092000) — the pre-flight check below has to
  // agree with that or a client with ONLY a billing_email on file (no
  // contact_email) would be reported as blocked for having "no email address
  // on file" while a send would in fact go out.
  billing_email: string | null;
  reminder_before_due: number[] | null;
  reminder_on_due: boolean | null;
  reminder_after_due: number[] | null;
};

type InvoiceRow = {
  id: string;
  invoice_number: string | null;
  client_id: string;
  status: string;
  due_on: string | null;
  sent_at: string | null;
  reminders_suppressed: boolean | null;
};

export type RunOptions = {
  /** The calendar day this pass is deciding for. Defaults to today, UTC. */
  today?: string;
  /** The instant to compose against — see sendInvoiceEmail's `now`. */
  now?: Date;
  /** Reply-to for anything sent. See sendInvoiceEmail's own parameter. */
  replyTo?: string;
};

/**
 * One account's pass. Safe to call twice: the second call finds every rung it
 * would have sent already recorded, and sends nothing.
 */
export async function runDueRemindersForAccount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  accountId: string,
  options: RunOptions = {}
): Promise<ReminderRunSummary> {
  const now = options.now ?? new Date();
  const today = options.today ?? toCalendarDate(now);
  const summary: ReminderRunSummary = emptySummary();

  // THE CLAIM IS TAKEN BEFORE ANYTHING IS READ, not after everything is sent.
  const claim = await claimRun(supabase, accountId, now);
  if (claim === "stood_down") {
    summary.notices.push(
      `A reminder pass already ran for this account in the last ${RUN_COOLDOWN_MINUTES} minutes, so this one stood down. Nothing was read and nothing was sent.`
    );
    return summary;
  }

  // THE MAIL SERVICE IS CHECKED ONCE, UP FRONT, AND THE PASS STILL RUNS.
  //
  // It does not return early, because the point of running anyway is the
  // reporting: the pilot gets a list of exactly which invoices would have
  // been chased, which is worth having and is what turns "the domain isn't
  // verified at Resend yet" (LAUNCH-GATES G5) from an invisible dead end into
  // a screen that says what is waiting. No rung is consumed and NO ROW OF ANY
  // KIND is written — including the stale skips below, which are gated on this
  // flag for exactly that reason: staleness is re-derived from the calendar on
  // every pass, so deferring those rows until there is a mail service loses
  // nothing and keeps "a pass with no mail service records nothing" true
  // rather than nearly true.
  const mailReady = emailIsConfigured();

  const { data: clientData, error: clientError } = await supabase
    .from("clients")
    .select(
      "id, name, contact_email, billing_email, reminder_before_due, reminder_on_due, reminder_after_due"
    )
    .eq("account_id", accountId)
    .is("archived_at", null);

  if (clientError) {
    summary.errors.push(friendlyDbError(clientError, "clients.select"));
    return summary;
  }

  const clients = new Map<string, { row: ClientRow; policy: ReturnType<typeof normalizeReminderPolicy> }>();
  for (const raw of (clientData ?? []) as ClientRow[]) {
    const policy = normalizeReminderPolicy({
      beforeDue: raw.reminder_before_due,
      onDue: raw.reminder_on_due,
      afterDue: raw.reminder_after_due,
    });
    // A client with no schedule is not in scope at all — no row read, no
    // decision, no chance of a message.
    if (reminderPolicyIsEmpty(policy)) continue;
    clients.set(raw.id, { row: raw, policy });
  }
  if (clients.size === 0) {
    await stampRun(supabase, accountId, now);
    return summary;
  }

  // STATUS IS FILTERED IN THE QUERY — and re-read again per invoice, in the
  // instant before that invoice's send. sendInvoiceReminder's own comment
  // explains why that matters: the gap between deciding and sending is exactly
  // where an invoice gets paid — by a Stripe webhook, in another tab, or by
  // the pilot recording a cheque on their phone. In a PASS that gap is not
  // milliseconds, it is minutes: this batch is read once and the fortieth
  // invoice's send can follow it by a PDF render and thirty-nine ten-second
  // mail timeouts. Only 'sent' and 'partial' can be chased; a paid invoice
  // must never be chased for $0.00 and a void one must never be chased for
  // money nobody owes.
  const { data: invoiceData, error: invoiceError } = await supabase
    .from("invoices")
    .select("id, invoice_number, client_id, status, due_on, sent_at, reminders_suppressed")
    .eq("account_id", accountId)
    .in("status", ["sent", "partial"])
    .not("due_on", "is", null)
    .in("client_id", [...clients.keys()])
    .order("due_on", { ascending: true })
    .limit(MAX_INVOICES_PER_ACCOUNT);

  if (invoiceError) {
    summary.errors.push(friendlyDbError(invoiceError, "invoices.select"));
    return summary;
  }
  const invoices = (invoiceData ?? []) as InvoiceRow[];
  summary.invoicesConsidered = invoices.length;
  if (invoices.length === 0) {
    await stampRun(supabase, accountId, now);
    return summary;
  }

  const invoiceIds = invoices.map((invoice) => invoice.id);

  const [{ data: sendData, error: sendError }, { data: shareData }] =
    await Promise.all([
      supabase
        .from("invoice_reminder_sends")
        .select("invoice_id, rule_key, outcome, created_at")
        .eq("account_id", accountId)
        .in("invoice_id", invoiceIds),
      // Best-effort, like every other read of this table: a failure here
      // costs the view-aware softening and nothing else.
      supabase
        .from("invoice_shares")
        .select("invoice_id, last_viewed_at, revoked_at")
        .eq("account_id", accountId)
        .in("invoice_id", invoiceIds),
    ]);

  // THE LEDGER READ IS THE ONE THAT MAY NOT FAIL SOFT. Without it every rung
  // looks unconsumed, and the pass would re-send every reminder this account
  // has ever sent. Stop instead.
  if (sendError) {
    summary.errors.push(
      `${friendlyDbError(sendError, "invoice_reminder_sends.select")} No reminders were sent — without the record of what has already gone out, sending anything risks sending it twice.`
    );
    return summary;
  }

  const consumedByInvoice = new Map<string, string[]>();
  const lastReminderByInvoice = new Map<string, string>();
  for (const row of (sendData ?? []) as {
    invoice_id: string;
    rule_key: string;
    outcome: "sent" | "failed" | "skipped";
    created_at: string;
  }[]) {
    // EVERY row consumes its rung — including 'manual', which is excluded
    // from the unique index and is not a rung, so it is skipped here rather
    // than added to a ladder it does not belong to.
    if (row.rule_key !== "manual") {
      const keys = consumedByInvoice.get(row.invoice_id) ?? [];
      keys.push(row.rule_key);
      consumedByInvoice.set(row.invoice_id, keys);
    }
    // …but ONLY A SUCCESSFUL SEND starts a quiet period. A skipped rung and a
    // refused send both reached nobody; counting either as "recently chased"
    // would have the scheduler stand down because of its own failure.
    if (row.outcome !== "sent") continue;
    const prior = lastReminderByInvoice.get(row.invoice_id);
    if (!prior || row.created_at > prior) {
      lastReminderByInvoice.set(row.invoice_id, row.created_at);
    }
  }

  const viewedByInvoice = new Map<string, string | null>();
  for (const row of (shareData ?? []) as {
    invoice_id: string;
    last_viewed_at: string | null;
    revoked_at: string | null;
  }[]) {
    // A revoked link's stamps describe a page the client can no longer open.
    viewedByInvoice.set(row.invoice_id, row.revoked_at ? null : row.last_viewed_at);
  }

  for (const invoice of invoices) {
    const entry = clients.get(invoice.client_id);
    if (!entry) continue;

    // ONE INVOICE'S FAILURE IS ONE INVOICE'S FAILURE. The file header promises
    // that nothing here throws; this is where that stops being a promise about
    // the code we can see and becomes one about the code we call. The send
    // path renders a PDF (lib/invoice-document.tsx's renderToBuffer is the one
    // step with no guard of its own), and a single poisoned invoice must not
    // abandon the rest of this account — still less every account after it in
    // the pass, which is precisely the "job silently not firing for a week"
    // failure this feature owes an answer to.
    try {
      await runOneInvoice(invoice, entry);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      summary.errors.push(
        `${
          invoice.invoice_number ?? "An invoice"
        } for ${entry.row.name} could not be processed: ${message}. Nothing was recorded for it, so it will be tried again on the next run.`
      );
      console.error(
        `[reminders] invoice ${invoice.id} threw during the pass: ${message}`
      );
    }
  }

  await stampRun(supabase, accountId, now);
  return summary;

  /**
   * One invoice, start to finish. Declared here rather than at module scope
   * because it closes over the batch reads above; the loop's try/catch is what
   * makes it safe for it to throw.
   */
  async function runOneInvoice(
    invoice: InvoiceRow,
    entry: { row: ClientRow; policy: ReturnType<typeof normalizeReminderPolicy> }
  ): Promise<void> {
    const decision = decideReminder({
      policy: entry.policy,
      dueOn: invoice.due_on,
      today,
      consumed: consumedByInvoice.get(invoice.id) ?? [],
      lastReminderAt: lastReminderByInvoice.get(invoice.id) ?? null,
      sentAt: invoice.sent_at,
      lastViewedAt: viewedByInvoice.get(invoice.id) ?? null,
      suppressed: invoice.reminders_suppressed === true,
    });

    if (decision.action === "hold") {
      // 'nothing_due' is the ordinary state of most invoices most days and is
      // not worth reporting; the rest are things a pilot may want to know.
      if (decision.reason !== "nothing_due") {
        summary.blocked.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoice_number,
          clientName: entry.row.name,
          reason: describeHold(decision.reason),
        });
      }
      return;
    }

    // THE TWO KINDS OF SKIP ARE RECORDED AT DIFFERENT MOMENTS, and the
    // difference is what each one is a fact ABOUT.
    //
    // 'stale' is a fact about TIME: this invoice went overdue, so a
    // before-due courtesy note can never be right again. True whether or not
    // anything is SENT today — so it is recorded before the send is attempted,
    // gated only on there being a mail service at all (see mailReady above:
    // an unconfigured deployment writes no rows of any kind, and staleness is
    // re-derived on every pass, so nothing is lost by waiting).
    //
    // 'superseded' is a fact about THIS SEND: a later rung said it better and
    // was sent instead. If the send below never happens — no mail service, no
    // client address — then nothing superseded anything, and consuming those
    // rungs would quietly eat a ladder that has not run yet. So they are
    // recorded only after a send is actually attempted.
    if (mailReady) {
      const stale = decision.supersede.filter((item) => item.reason === "stale");
      for (const item of stale) {
        const record = await recordOutcome(supabase, accountId, invoice.id, {
          rung: item.rung,
          outcome: "skipped",
          detail:
            "Its moment had passed — this invoice went overdue, and a note saying it is due shortly would no longer be true.",
        });
        if (record.ok) summary.skipped += 1;
      }
    }

    if (decision.action === "consume") return;

    // Pre-flight refusals. Nothing is written for these — see the `blocked`
    // comment on ReminderRunSummary.
    if (!mailReady) {
      summary.blocked.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        clientName: entry.row.name,
        reason:
          "A reminder was due, but emailing isn't set up on this deployment yet, so nothing was sent and nothing was marked as sent.",
      });
      return;
    }
    if (
      !looksLikeEmail(entry.row.billing_email) &&
      !looksLikeEmail(entry.row.contact_email)
    ) {
      summary.blocked.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        clientName: entry.row.name,
        reason: `A reminder was due, but ${entry.row.name} has no email address on file. Add one and it will go out on the next run.`,
      });
      return;
    }

    // STATUS, RE-READ IN THE LAST MOMENT BEFORE THE SEND.
    //
    // The batch read above was the query filter; this is the check. Between
    // the two sits every send that came before this one in the pass, and an
    // invoice paid in that window must not be chased — buildInvoiceDocument
    // reads pilot.invoice_totals live at compose time, so the client would
    // receive a payment reminder showing a balance due of $0.00. The manual
    // path (invoices/actions.ts sendInvoiceReminder) re-reads for exactly this
    // reason; the scheduled path has the longer gap of the two.
    //
    // A FAILED READ REFUSES THE SEND rather than assuming the status held: the
    // rung stays unconsumed and tomorrow's pass tries again, which costs a day
    // and nothing else. It is reported as blocked, not as a ledger row.
    const { data: statusData, error: statusError } = await supabase
      .from("invoices")
      .select("status")
      .eq("id", invoice.id)
      .eq("account_id", accountId)
      .maybeSingle();
    const currentStatus = (statusData as { status: string } | null)?.status;
    if (statusError || (currentStatus !== "sent" && currentStatus !== "partial")) {
      summary.blocked.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        clientName: entry.row.name,
        reason: statusError
          ? `A reminder was due, but this invoice's status couldn't be re-checked just before sending, so nothing was sent. It will be tried again on the next run.`
          : currentStatus === "paid"
            ? "A reminder was due, but the invoice was paid while this run was in progress, so nothing was sent."
            : currentStatus === "void"
              ? "A reminder was due, but the invoice was voided while this run was in progress, so nothing was sent."
              : "A reminder was due, but the invoice is no longer in a state that can be chased, so nothing was sent.",
      });
      return;
    }

    // SEND FIRST, RECORD AFTER, and the order is deliberate.
    //
    // Claiming the rung before sending would mean a crash between the two
    // leaves a row saying 'sent' for a mail that never left — the
    // looks-like-success failure lib/email/send.ts exists to prevent, written
    // into the ledger where nothing can correct it. This way round, the same
    // crash leaves the rung unconsumed and tomorrow's pass may send one
    // duplicate. A duplicate reminder is visible and survivable; a silent
    // false record of one is neither.
    const sent = await sendInvoiceEmail(
      supabase,
      accountId,
      invoice.id,
      "reminder",
      options.replyTo,
      // Same default as every other surface, and the same one the manual
      // reminder path takes: the full document, receipts included.
      true,
      // No per-send note: nobody is here to write one.
      null,
      now
    );

    const record = await recordOutcome(supabase, accountId, invoice.id, {
      rung: decision.rung,
      outcome: sent.ok ? "sent" : "failed",
      detail: sent.ok ? null : sent.error,
      providerMessageId: sent.ok ? sent.messageId : null,
    });

    // Now — and only now — the rungs this send stood in for. THE DETAIL TELLS
    // THE TRUTH ABOUT WHICH SEND: this table's whole design principle is that
    // every row carries its real outcome, and "was sent instead of this one"
    // written next to a rung whose send returned a 403 is a row that lies. The
    // rungs are still consumed either way — a superseded rung could never go
    // out once a later one has been attempted — but the reason says what
    // actually happened, so the panel's four rows agree with each other.
    for (const item of decision.supersede) {
      if (item.reason !== "superseded") continue;
      const superseded = await recordOutcome(supabase, accountId, invoice.id, {
        rung: item.rung,
        outcome: "skipped",
        detail: sent.ok
          ? "A later reminder in the same schedule came due at the same time and was sent instead of this one."
          : "A later reminder in the same schedule came due at the same time and took precedence — its send failed, and that rung's own row says why.",
      });
      if (superseded.ok) summary.skipped += 1;
    }

    if (sent.ok) summary.sent += 1;
    else summary.failed += 1;

    if (!record.ok && sent.ok) {
      // THE MAIL WENT OUT AND THE LEDGER DOES NOT KNOW IT. Two different
      // futures, and the pilot is told about both — surfaced in the summary
      // rather than only console.error'd, because `errors` reaches the
      // Settings panel and the cron route's response, and a clean "1 reminder
      // sent" over a duplicate about to happen is the send-before-marker
      // failure this whole ordering exists to keep visible.
      const reason = record.conflict
        ? "another pass recorded the same rung, which means it very probably sent the same reminder"
        : "the record of it could not be written, so the next run may send it a second time";
      summary.errors.push(
        `${
          invoice.invoice_number ?? "An invoice"
        } for ${entry.row.name}: the reminder was sent, but ${reason}.`
      );
      console.error(
        `[reminders] invoice ${invoice.id} rung ${decision.rung.key} was sent but not recorded (${
          record.conflict ? "unique-index collision" : record.message
        }).`
      );
    }
  }
}

/**
 * Every account with at least one live membership, one at a time.
 *
 * SEQUENTIAL, NOT PARALLEL. Each account's pass renders PDFs and talks to a
 * mail service with a ten-second timeout; running them at once is how one
 * slow account starves the rest of the invocation. The daily volume this is
 * built for is a handful of sends across a handful of tenants.
 */
export async function runAllDueReminders(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceClient: any,
  options: RunOptions = {}
): Promise<{ accounts: number; summary: ReminderRunSummary }> {
  const combined: ReminderRunSummary = emptySummary();

  const { data, error } = await serviceClient
    .from("accounts")
    .select("id")
    // Only accounts whose subscription is in a state that gets the product.
    // A cancelled tenant's clients must not keep receiving mail on their
    // behalf, and this mirrors how the rest of the app gates on status.
    .in("status", ["trialing", "active", "past_due"]);

  if (error) {
    combined.errors.push(friendlyDbError(error, "accounts.select"));
    return { accounts: 0, summary: combined };
  }

  const accounts = (data ?? []) as { id: string }[];
  for (const account of accounts) {
    // ONE TENANT'S PASS CANNOT END THE POUND. Accounts iterate in a fixed
    // order, so an exception escaping here would abort the same account every
    // day and every tenant after it in that order would silently receive
    // nothing — indefinitely, with a cron-log 500 as the only evidence. That
    // is the exact failure this feature exists to answer, so it is caught per
    // account as well as per invoice.
    try {
      const replyTo = await ownerEmail(serviceClient, account.id);
      const summary = await runDueRemindersForAccount(serviceClient, account.id, {
        ...options,
        replyTo,
      });
      combined.invoicesConsidered += summary.invoicesConsidered;
      combined.sent += summary.sent;
      combined.failed += summary.failed;
      combined.skipped += summary.skipped;
      combined.blocked.push(...summary.blocked);
      combined.errors.push(...summary.errors);
      combined.notices.push(...summary.notices);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      combined.errors.push(
        `One account's reminder pass could not be completed: ${message}. The rest of the pass continued.`
      );
      console.error(
        `[reminders] account ${account.id} threw during the pass: ${message}`
      );
    }
  }

  return { accounts: accounts.length, summary: combined };
}

/**
 * WHERE A CLIENT'S REPLY GOES when there is no session to ask.
 *
 * The account owner's own verified auth address, resolved through the admin
 * API — the same mailbox the interactive path uses, reached the only way a
 * job can reach it. An account with no resolvable owner address sends with no
 * reply-to rather than with the platform's: sendInvoiceEmail's header explains
 * why a reply landing in the software vendor's inbox is the one outcome that
 * must never happen.
 */
async function ownerEmail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceClient: any,
  accountId: string
): Promise<string | undefined> {
  try {
    const { data } = await serviceClient
      .from("account_members")
      .select("user_id")
      .eq("account_id", accountId)
      .eq("role", "owner")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const userId = (data as { user_id: string } | null)?.user_id;
    if (!userId) return undefined;
    const { data: userData } = await serviceClient.auth.admin.getUserById(userId);
    const email = userData?.user?.email;
    return looksLikeEmail(email) ? email : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The result of trying to append one ledger row.
 *
 * `conflict` separates the two failures the caller has to describe
 * differently: a unique-index collision means ANOTHER PASS already recorded
 * this rung (and very probably sent it), while any other insert failure means
 * a send this pass made is unrecorded and may go out again tomorrow. Reporting
 * the first wording for the second case is a wrong diagnosis in the one place
 * a duplicate becomes knowable.
 */
type RecordResult =
  | { ok: true }
  | { ok: false; conflict: boolean; message: string };

/**
 * Appends one row. Returns ok:false when the insert did not land, so the
 * caller can say so rather than counting it as recorded.
 */
async function recordOutcome(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  accountId: string,
  invoiceId: string,
  entry: {
    rung: Rung;
    outcome: "sent" | "failed" | "skipped";
    detail?: string | null;
    providerMessageId?: string | null;
  }
): Promise<RecordResult> {
  const { error } = await supabase.from("invoice_reminder_sends").insert({
    account_id: accountId,
    invoice_id: invoiceId,
    rule_key: entry.rung.key,
    outcome: entry.outcome,
    detail: entry.detail ?? null,
    provider_message_id: entry.providerMessageId ?? null,
  } as never);
  if (error) {
    const conflict = error.code === "23505";
    console.error(
      `[reminders] could not record ${entry.outcome} for invoice ${invoiceId} rung ${entry.rung.key}: ${error.message}`
    );
    return { ok: false, conflict, message: error.message ?? "insert failed" };
  }
  return { ok: true };
}

/**
 * CLAIMS THE ACCOUNT FOR THIS PASS, at the start, before anything is read.
 *
 * One conditional UPDATE: move the watermark forward only if it is null or
 * older than the cooldown. Postgres serialises the two writers, so of two
 * passes racing to start, exactly one sees a row count of 1 and the other sees
 * 0 — which is the arbitration the unique index on invoice_reminder_sends
 * cannot provide, because that index only stops the second RECORDING, never
 * the second SEND.
 *
 * THREE ANSWERS, and the third is why this is not simply a boolean:
 *
 *   * "claimed"     — this pass holds the account. Proceed.
 *   * "stood_down"  — someone else holds it, or held it within the cooldown.
 *   * "unclaimable" — the update matched nothing AND the watermark is not
 *     fresh, which is what a MEMBER's session sees: the RLS policy on
 *     pilot.accounts is is_account_owner, so a bookkeeper pressing "Run now"
 *     can never write this column. Refusing to run would break their button
 *     outright, so they proceed on the weaker guarantee the design had before
 *     (the unique index, plus a read of the watermark) and the residual is
 *     confined to one tenant's own duplicate mail. The cron pass and every
 *     owner take the real lease.
 */
async function claimRun(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  accountId: string,
  now: Date
): Promise<"claimed" | "stood_down" | "unclaimable"> {
  const cutoff = new Date(
    now.getTime() - RUN_COOLDOWN_MINUTES * 60_000
  ).toISOString();

  const { error, count } = await supabase
    .from("accounts")
    .update({ reminders_last_run_at: now.toISOString() } as never, {
      count: "exact",
    })
    .eq("id", accountId)
    // Quoted: the timestamp contains dots, and an unquoted value is parsed by
    // splitting on them.
    .or(`reminders_last_run_at.is.null,reminders_last_run_at.lt."${cutoff}"`);

  if (!error && count === 1) return "claimed";
  if (error) {
    console.error(
      `[reminders] could not claim the run for account ${accountId}: ${error.message}`
    );
  }

  // The claim did not land. Which of the two reasons it was decides whether
  // this pass may go on, and the watermark itself is the only witness.
  const { data, error: readError } = await supabase
    .from("accounts")
    .select("reminders_last_run_at")
    .eq("id", accountId)
    .maybeSingle();

  // A FAILED READ IS NOT "it ran recently" — refusing to run because the
  // watermark could not be read would turn a transient blip into a silently
  // skipped day, which is the failure this whole design is answering.
  if (readError) return "unclaimable";
  const last = (data as { reminders_last_run_at: string | null } | null)
    ?.reminders_last_run_at;
  if (!last) return "unclaimable";
  const at = Date.parse(last);
  if (Number.isNaN(at)) return "unclaimable";
  return now.getTime() - at < RUN_COOLDOWN_MINUTES * 60_000
    ? "stood_down"
    : "unclaimable";
}

/**
 * The watermark again at the END of a pass, so "Last run" is the end of the
 * work rather than the start of it. claimRun already wrote it for anyone who
 * could; this is best-effort for the same reason that was — a member or
 * bookkeeper pressing "run now" has no UPDATE on pilot.accounts (the policy is
 * is_account_owner), so it matches zero rows for them. The reminders still
 * went out and were recorded; only "last run" is stale, and failing the whole
 * pass over a display timestamp would be the wrong trade.
 */
async function stampRun(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  accountId: string,
  now: Date
): Promise<void> {
  const { error } = await supabase
    .from("accounts")
    .update({ reminders_last_run_at: now.toISOString() } as never)
    .eq("id", accountId);
  if (error) {
    console.error(
      `[reminders] could not stamp reminders_last_run_at for account ${accountId}: ${error.message}`
    );
  }
}
