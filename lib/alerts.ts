import "server-only";
import { BRAND } from "@/lib/brand";
import { emailIsConfigured, sendEmail } from "@/lib/email/send";

/**
 * OPERATOR ALERTING — THE PRODUCT'S ONLY FAILURE SIGNAL, PERIOD.
 *
 * The audit's headline finding: nothing in this codebase watches itself.
 * console.error is the entire failure surface repo-wide, including both
 * Stripe webhook handlers (app/api/stripe/webhook, app/api/stripe/
 * connect-webhook) — the sole writers of every payment record and every
 * autopay charge — and both unattended crons. A webhook that throws today
 * logs a line into a Vercel console nobody is tailing and returns a 500
 * that a person finds out about only when a pilot's money goes missing.
 *
 * The owner's call was email over an error-tracking vendor (Sentry and
 * kin), reusing the mail path this repo already has rather than adding
 * one. That keeps the dependency count where README wants it (see
 * lib/email/send.ts's header) and means one Resend account, already paid
 * for, already verified, covers both "tell a pilot their card failed" and
 * "tell us the webhook that records that failure just broke."
 *
 * WHAT THIS BUYS, AND WHAT IT DOES NOT.
 * It buys a tripwire: something breaks, a human's inbox gets a line about
 * it, same day. It does NOT buy anything a real error tracker would:
 *   - no grouping — the same crash from 40 requests is 40 emails (subject
 *     to the throttle below, which caps that, it does not dedupe it)
 *   - no stack aggregation, no symbolication, no "this regressed in commit X"
 *   - no cross-instance suppression — see the throttle note below
 *   - no historical search, no dashboards, no alerting rules beyond "did an
 *     email go out"
 * This is instrumentation of last resort, not observability. It exists so
 * the FIRST failure in an unmonitored path is not also the LAST one anyone
 * hears about, not to replace a real error tracker if the product ever
 * warrants one.
 *
 * WHO IT REACHES. This must go to the PLATFORM, never a tenant — the
 * pilot whose webhook call happened to be the one that failed did nothing
 * wrong and cannot fix a bug in this product. lib/email/owner-email.ts
 * resolves a per-ACCOUNT owner and says explicitly why it refuses to fall
 * back to a platform address: doing so "would put the software vendor
 * into somebody else's correspondence." That is the tenant-facing rule.
 * This file is its mirror on the platform-facing side: BRAND.supportEmail
 * (lib/brand.ts) is documented there as a real, human-read inbox — not a
 * no-reply — for exactly this reason, and .env.example spells out that it
 * is the one address configured to reach a person. Reusing it here is the
 * "right existing path" rather than a new env var, because a second
 * platform-address source would be one more place to keep in sync with
 * the first the day it changes.
 */

const OPERATOR_ADDRESS = BRAND.supportEmail;

export type AlertEvent = {
  /** Where this came from — "stripe-webhook", "holds-cron", etc. Short, stable, greppable. */
  source: string;
  /** One line. Becomes (most of) the subject, so keep it a subject, not a paragraph. */
  summary: string;
  /**
   * Stack trace, error message, whatever context makes this actionable.
   * NEVER put a secret, an API token, full card data, or a raw request
   * body in here — this travels over email, unencrypted-at-rest in an
   * inbox, to a human, not into a system built to hold secrets. Callers
   * own that line; this function does not attempt to scrub content it has
   * no way to reliably recognise.
   */
  detail?: string;
  /** pilot.accounts.id, when the failure is scoped to one tenant. */
  accountId?: string;
};

/**
 * Longest a subject or detail block is allowed to get before this
 * truncates it. Not a security control — a courtesy so one runaway stack
 * trace or a summary someone built out of a whole JSON payload doesn't
 * turn an alert email into the thing that gets it spam-foldered.
 */
const MAX_SUMMARY_CHARS = 200;
const MAX_DETAIL_CHARS = 4_000;

/**
 * FLOOD CONTROL — an in-process map, not a queue, not a database row.
 *
 * A webhook that starts failing on every delivery must not become 500
 * emails. This throttles by source+summary: the first alert for a given
 * pair sends immediately, later ones for the same pair inside the window
 * below are swallowed (logged, not mailed) until it expires.
 *
 * WHAT THIS DOES NOT GUARANTEE, and why that is an acceptable trade here:
 * this Map lives in the memory of ONE serverless function instance.
 * Vercel can and does run several instances of the same route concurrently
 * under load, each with its own empty Map, so the same failure hitting two
 * warm instances can still produce two alerts — this is best-effort
 * per-instance suppression, not a distributed rate limit. A real one would
 * need a shared store (a database row, a Redis counter) and this task is
 * explicitly not building that: the failure this exists to catch is "zero
 * signal," and reducing "500 emails" to "a handful" already fixes the
 * failure mode that matters. Reaching for cross-instance precision here is
 * the over-engineering the brief asks this file to avoid.
 */
const THROTTLE_MS = 15 * 60 * 1000;
/** Belt-and-suspenders against unbounded growth in a long-lived warm instance. */
const MAX_TRACKED_KEYS = 500;
const lastSentAt = new Map<string, number>();

function throttleKey(event: AlertEvent): string {
  return `${event.source}\u0000${event.summary}`;
}

/** True (and records the attempt) when this source+summary may send now. */
function admitAndRecord(event: AlertEvent, now: number): boolean {
  const key = throttleKey(event);
  const last = lastSentAt.get(key);
  if (last !== undefined && now - last < THROTTLE_MS) return false;

  // A blunt cap, not an LRU: this map exists to stop one hot failure from
  // flooding an inbox, not to be a precise cache. If it somehow grew past
  // the bound (many distinct source+summary pairs failing at once), the
  // honest move is to drop the oldest bookkeeping and keep alerting —
  // never to stop sending because the throttle itself got big.
  if (lastSentAt.size >= MAX_TRACKED_KEYS) {
    const oldestKey = lastSentAt.keys().next().value;
    if (oldestKey !== undefined) lastSentAt.delete(oldestKey);
  }
  lastSentAt.set(key, now);
  return true;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}… [truncated]` : value;
}

/** A subject line is one line — a stray newline in `summary` would break the header. */
function subjectSafe(value: string): string {
  return truncate(value.replace(/\s+/g, " ").trim(), MAX_SUMMARY_CHARS);
}

/**
 * Tell the platform operator something broke. Fire-and-forget from the
 * caller's point of view.
 *
 * MUST NEVER THROW — this is the single property that matters more than
 * any other in this file. Every call site is inside a webhook handler or a
 * cron pass that is already in a failure branch; a bug in alerting itself
 * must not turn a handled failure into a 500 that takes the whole request
 * down. Every branch below is therefore either a no-op or a caught,
 * logged, swallowed failure — there is no path out of this function but a
 * resolved promise.
 */
export async function alertOperator(event: AlertEvent): Promise<void> {
  try {
    // No-op, not an error, when mail isn't configured — the same switch
    // lib/email/send.ts already reads. Local dev and CI run with no
    // RESEND_API_KEY, and that must stay silent rather than fail a test
    // suite that never asked to send mail.
    if (!emailIsConfigured()) return;

    const now = Date.now();
    if (!admitAndRecord(event, now)) {
      console.error(
        `[alerts] throttled (source=${event.source}): ${event.summary} — an earlier alert for the same source+summary went out within the last ${THROTTLE_MS / 60_000} min.`
      );
      return;
    }

    const timestamp = new Date(now).toISOString();
    const subject = `[${BRAND.name} ALERT] ${event.source}: ${subjectSafe(event.summary)}`;

    const lines = [
      `Source: ${event.source}`,
      `Time: ${timestamp}`,
      ...(event.accountId ? [`Account: ${event.accountId}`] : []),
      ``,
      event.summary,
    ];
    if (event.detail) {
      lines.push(``, truncate(event.detail, MAX_DETAIL_CHARS));
    }

    const result = await sendEmail({
      to: OPERATOR_ADDRESS,
      subject: truncate(subject, MAX_SUMMARY_CHARS + 32),
      text: lines.join("\n"),
      fromName: `${BRAND.name} Alerts`,
    });

    if (!result.ok) {
      // The alert failed to send. Console is the only fallback left — the
      // same console.error every other failure in this product already
      // uses, so at minimum this shows up next to everything else that
      // was never wired to anything.
      console.error(
        `[alerts] send failed (${result.kind}) for source=${event.source}: ${result.error}`
      );
    }
  } catch (err) {
    console.error(
      `[alerts] alertOperator threw for source=${event.source}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}
