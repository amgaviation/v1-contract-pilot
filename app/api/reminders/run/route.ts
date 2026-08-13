import {
  createHash,
  timingSafeEqual as cryptoTimingSafeEqual,
} from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service-role";
import { runAllDueReminders } from "@/lib/reminders/run";

/**
 * THE DAILY DUE-REMINDER PASS — the product's only scheduled entry point.
 *
 * WHY AN HTTP ROUTE IN THIS APP, and not the two alternatives:
 *
 *   * pg_cron + an Edge Function. There is no Edge Function infrastructure in
 *     this project at all (no supabase/functions directory, a minimal
 *     config.toml, no pg_cron provisioned), and everything a reminder needs —
 *     the React-PDF document, the message builder, the preference resolver,
 *     the receipt embedder — lives in this Next.js server. A function would
 *     either duplicate all of it or HTTP back into this route, which is this
 *     option with more moving parts to keep in step.
 *   * Nothing at all, i.e. the recurring-invoices "due queue" the pilot works
 *     through by hand. That is the floor this keeps (see the Settings button,
 *     which calls the same pass), but on its own it does not deliver the
 *     thing this feature exists for: a chase that goes out while the pilot is
 *     flying, which is the delta docs/WAVE-PARITY.md §1.4 names.
 *
 * Vercel Cron calls this with a GET and an `Authorization: Bearer
 * $CRON_SECRET` header, which is why GET is the verb here. POST is accepted
 * too, for a manual curl against a deployment.
 *
 * DORMANT WITHOUT CONFIGURATION, on purpose and in the same shape as
 * emailIsConfigured()'s degradation: with CRON_SECRET unset this route does
 * nothing at all and says so. A `crons` entry in vercel.json against an
 * unconfigured deployment is therefore inert — it produces one 503 a day and
 * touches no data — so the entry can ship before the secret does.
 *
 * Runs on Node, not Edge: the service-role Supabase client and React-PDF both
 * expect Node APIs, same as the Stripe webhook route.
 */
export const runtime = "nodejs";
/** Never cached or statically analysed — it must execute per call. */
export const dynamic = "force-dynamic";
/**
 * A pass renders a PDF per send and talks to a mail service with a 10s
 * timeout. The per-account cap in lib/reminders/run.ts keeps a single account
 * bounded; this is the outer bound for the whole pass.
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  // NOT CONFIGURED IS NOT AN ERROR AND IS NOT A SUCCESS. 503 with an
  // explanation: a deployment that has never set the secret is the ordinary
  // pre-launch state, and this route must not quietly appear to work.
  if (!secret) {
    return NextResponse.json(
      {
        ran: false,
        reason:
          "CRON_SECRET is not set on this deployment, so scheduled reminders are switched off. Nothing was read and nothing was sent.",
      },
      { status: 503 }
    );
  }

  // THE ONLY THING STANDING BETWEEN THE PUBLIC INTERNET AND A JOB THAT EMAILS
  // OTHER PEOPLE'S CLIENTS. Compared in constant time so the endpoint is not a
  // byte-at-a-time oracle for the secret, and answered with a bare 401 that
  // says nothing about whether the secret exists or how long it is.
  const presented = bearerToken(request.headers.get("authorization"));
  if (!presented || !timingSafeEqual(presented, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The service-role client is entry point 3 in lib/supabase/service-role.ts's
  // list, and that file's header carries the argument for why this one is
  // narrow: it reads and writes only reminder machinery, on behalf of the
  // account that owns each row, because a scheduled pass has no session to be.
  const supabase = createServiceClient();

  try {
    const { accounts, summary } = await runAllDueReminders(supabase);
    // Logged as well as returned: the response goes to a cron runner nobody
    // reads, and the platform's function logs are where a pilot's support
    // question gets answered.
    //
    // `notices` is counted SEPARATELY from `errors`. A pass that stood down
    // because another was already running is a routine no-op, and reporting it
    // as "1 error" is how a monitor learns to ignore the one number that would
    // have told it about a real database failure.
    console.log(
      `[reminders] pass over ${accounts} account(s): ${summary.sent} sent, ${summary.failed} failed, ${summary.skipped} skipped, ${summary.blocked.length} blocked, ${summary.errors.length} error(s), ${summary.notices.length} notice(s)`
    );
    return NextResponse.json({
      ran: true,
      accounts,
      sent: summary.sent,
      failed: summary.failed,
      skipped: summary.skipped,
      blocked: summary.blocked.length,
      errors: summary.errors,
      notices: summary.notices,
    });
  } catch (err) {
    // runDueRemindersForAccount does not throw by design, so reaching here
    // means something structural (the service key missing, the database
    // unreachable). 500 so the platform's own retry and alerting see it.
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(`[reminders] pass failed: ${message}`);
    return NextResponse.json({ error: "Reminder pass failed" }, { status: 500 });
  }
}

function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

/**
 * Constant-time in both content AND length: each side is hashed first, and the
 * two fixed-width 32-byte digests are compared with node:crypto's own
 * timingSafeEqual.
 *
 * WHY NOT COMPARE THE STRINGS DIRECTLY. node:crypto's timingSafeEqual THROWS
 * on a length mismatch, which would leak the secret's length through the
 * difference between a 500 and a 401 — the exact signal a constant-time
 * compare exists to hide. Hashing first removes the question: digests are
 * always the same size, so there is no mismatch to throw on and no loop whose
 * trip count tracks the secret. (The hand-rolled version this replaces was
 * constant-time in content but ran for max(a.length, b.length) iterations,
 * which still correlated with the secret's length for shorter inputs — a
 * residual its own comment claimed it did not have.)
 */
function timingSafeEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return cryptoTimingSafeEqual(digestA, digestB);
}
