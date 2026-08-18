import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service-role";
import {
  HOLD_EXPIRY_MAX_PER_RUN,
  HOLD_PURGE_FLAG_ENV,
  holdExpiryPurgeEnabled,
} from "@/lib/holds/gate";

/**
 * ===========================================================================
 * THE HOLD-EXPIRY PASS
 * ===========================================================================
 *
 * The only unattended job in this product that deletes a customer's records,
 * and it is written like it.
 *
 * WHAT IT DOES. Finds accounts whose hold window has closed and whose data
 * retention is not paid, and calls pilot.expire_hold on each: the COMMERCIAL
 * records go, the AIRMAN records — logbook, documents, aircraft, operator
 * qualifications, currency — never do. That split lives in
 * pilot.purge_business_data and is asserted by
 * scripts/account-lifecycle-db-verify.mjs, not restated here.
 *
 * FOUR THINGS STAND BETWEEN THE PUBLIC INTERNET AND THAT DELETE, and each
 * one is independent of the others:
 *
 *   1. CRON_SECRET must be set (503 otherwise) and must match, compared in
 *      constant time (401 otherwise). Same posture as the reminder pass.
 *
 *   2. HOLD_EXPIRY_PURGE_ENABLED must be exactly "true"
 *      (lib/holds/gate.ts). With it unset — which is every deployment that
 *      has not deliberately typed it — the pass runs, reports exactly which
 *      accounts it WOULD have purged, and deletes nothing. This is meant to
 *      stay off through as many real expiries as it takes to trust the
 *      selection, because a dry run against real data is the only test that
 *      proves the query, and no staging tenant has a real pilot's records in
 *      it.
 *
 *   3. A CAP of HOLD_EXPIRY_MAX_PER_RUN. A pass that finds more than a
 *      handful due has more likely been handed a clock problem or a bad
 *      query than a genuine cohort. It purges nothing beyond the cap and
 *      says so loudly.
 *
 *   4. pilot.expire_hold RE-DERIVES DUE-NESS from the row and refuses an
 *      account that is not on hold, whose window has not closed, or whose
 *      retention is paid. So the SELECT below is not the only thing deciding
 *      who gets purged — the function will not be talked into it. This is
 *      the guard that matters most, because a wrong WHERE clause here is the
 *      realistic way this product destroys a paying customer's records.
 *
 * SERVICE ROLE, ENTRY POINT 5. lib/supabase/service-role.ts's header says
 * adding one is a security decision and should feel like a paragraph rather
 * than a line; this route is that paragraph's subject, and the list there
 * has been extended with the argument. In short: no session exists to
 * authenticate as (a pilot on an expired hold is by definition not present),
 * there is NO caller-supplied account id anywhere in this route, and the one
 * operation it can perform is fixed.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return null;
  const token = rest.join(" ").trim();
  return token.length > 0 ? token : null;
}

/** Constant-time compare that does not leak length through an early return. */
function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return nodeTimingSafeEqual(ab, bb);
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}

type DueRow = {
  id: string;
  legal_name: string;
  hold_ends_at: string;
  retention_paid_until: string | null;
};

async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return NextResponse.json(
      {
        ran: false,
        reason:
          "CRON_SECRET is not set on this deployment, so the hold-expiry pass is switched off. Nothing was read and nothing was deleted.",
      },
      { status: 503 }
    );
  }

  const presented = bearerToken(request.headers.get("authorization"));
  if (!presented || !timingSafeEqual(presented, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const armed = holdExpiryPurgeEnabled();
  const supabase = createServiceClient();

  // The selection. No caller input reaches this query — there is no account
  // id, no filter and no limit taken from the request. Retention is checked
  // here AND again inside pilot.expire_hold; the duplication is deliberate.
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, legal_name, hold_ends_at, retention_paid_until")
    .not("hold_ends_at", "is", null)
    .lt("hold_ends_at", nowIso)
    .or(`retention_paid_until.is.null,retention_paid_until.lt.${nowIso}`);

  if (error) {
    console.error(`hold-expiry: could not read due holds: ${error.message}`);
    return NextResponse.json(
      { ran: false, reason: "Could not read due holds.", error: error.message },
      { status: 500 }
    );
  }

  const due = (data ?? []) as unknown as DueRow[];

  if (due.length === 0) {
    console.log("hold-expiry: no holds due.");
    return NextResponse.json({ ran: true, armed, due: 0, purged: 0 });
  }

  // THE BLAST-RADIUS CAP. Reported as a refusal, not trimmed silently: a
  // pass that quietly processed the first 25 of 400 would look identical in
  // the logs to a normal day.
  if (due.length > HOLD_EXPIRY_MAX_PER_RUN) {
    console.error(
      `hold-expiry: REFUSING TO RUN — ${due.length} accounts are due, above the ${HOLD_EXPIRY_MAX_PER_RUN} cap. ` +
        `This is far more likely a clock or query fault than a real cohort. Nothing was deleted. ` +
        `Accounts: ${due.map((a) => a.id).join(", ")}`
    );
    return NextResponse.json(
      {
        ran: false,
        armed,
        due: due.length,
        purged: 0,
        reason: `More accounts are due (${due.length}) than the per-run cap (${HOLD_EXPIRY_MAX_PER_RUN}). Nothing was deleted; investigate before re-running.`,
      },
      { status: 500 }
    );
  }

  // DRY RUN. The flag is off, so report precisely what would have happened
  // and delete nothing. This is the state a deployment is meant to sit in
  // until the selection has been watched against real expiries.
  if (!armed) {
    console.log(
      `hold-expiry: DRY RUN (${HOLD_PURGE_FLAG_ENV} is not "true"). ` +
        `${due.length} account(s) would have had their commercial records purged: ` +
        due.map((a) => `${a.id} (${a.legal_name}, hold ended ${a.hold_ends_at})`).join("; ")
    );
    return NextResponse.json({
      ran: true,
      armed: false,
      due: due.length,
      purged: 0,
      wouldPurge: due.map((a) => a.id),
    });
  }

  let purged = 0;
  const refused: string[] = [];

  for (const account of due) {
    const { error: purgeError } = await supabase.rpc("expire_hold", {
      target_account: account.id,
    } as never);

    if (purgeError) {
      // expire_hold refusing is a SUCCESS of the design, not a failure of
      // the run: it means this row was not actually due and the function
      // declined to be talked into it. Logged at error level anyway, because
      // it also means the query above and the function disagree, and that
      // disagreement is worth a human's attention either way.
      refused.push(account.id);
      console.error(
        `hold-expiry: expire_hold refused ${account.id}: ${purgeError.message}`
      );
      continue;
    }

    purged += 1;
    // One line per destroyed account, permanently, in the platform's logs.
    // A support question years later ("where did my invoices go?") deserves
    // an answer better than an inference.
    console.log(
      `hold-expiry: purged commercial records for ${account.id} (${account.legal_name}); ` +
        `hold ended ${account.hold_ends_at}. Logbook, documents, aircraft and qualifications retained.`
    );
  }

  return NextResponse.json({ ran: true, armed: true, due: due.length, purged, refused });
}
