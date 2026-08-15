/**
 * ===========================================================================
 * EMAIL CONFIRMATION: the two cookies and the resend throttle
 * ===========================================================================
 *
 * WHAT THIS FILE IS FOR. Signup confirmation has two pieces of state that
 * outlive a single request and cannot live in a query string:
 *
 *   1. WHICH ADDRESS THE LINK WENT TO, so /check-email can name it and so
 *      the resend has something to resend to.
 *   2. HOW OFTEN THIS BROWSER HAS ALREADY ASKED FOR A LINK, so the resend
 *      control can refuse before it reaches Supabase.
 *
 * WHY NOT A QUERY STRING FOR THE ADDRESS. `/check-email?email=...` is
 * writable by anyone. A stranger could hand a pilot a link to the real
 * product, on the real domain, that renders "We sent a confirmation link to
 * <attacker-chosen address>" in this product's own type. That is a phishing
 * primitive the product would be supplying for free. It also writes the
 * address into browser history, into the Referer of anything the page
 * links to, and into any log that records paths. A cookie set by the server
 * action that actually performed the signUp is the only version of this the
 * page can vouch for, so that is what it uses, and it is httpOnly so no
 * script can read it back out either.
 *
 * WHY THE THROTTLE LIVES IN A COOKIE TOO. Supabase enforces its own
 * per-address email limits, but they are reached by SENDING, so relying on
 * them alone means the pilot's fourth impatient click is the one that
 * discovers the limit, and what they see is a Supabase error rather than an
 * answer. The cookie lets the UI refuse first and say when to try again.
 *
 * HONEST ABOUT WHAT THE COOKIE IS NOT. A cookie can be deleted, so this is
 * a guard against impatience and double-clicks, not against an attacker
 * with a shell. The backstop against genuine abuse is Supabase's own
 * per-address rate limit, which no client-side state can move.
 *
 * PURE ON PURPOSE. Nothing here imports next/headers or Supabase, so the
 * decision logic can be exercised directly by node:test
 * (tests/resend-confirmation.test.mjs). Reading and writing the cookies is
 * the caller's job.
 */

/**
 * The address a signup confirmation link was just sent to. Set by
 * app/(auth)/signup/actions.ts, read by /check-email and by the resend
 * action. httpOnly at every call site.
 */
export const PENDING_SIGNUP_COOKIE = "pending_signup_email";

/**
 * Long enough to survive a pilot switching to their mail client, finding
 * nothing, and coming back; short enough that a shared machine is not still
 * naming someone's address an hour later.
 */
export const PENDING_SIGNUP_MAX_AGE_SECONDS = 1800; // 30 minutes

/** The send history behind the throttle. Comma-separated epoch seconds. */
export const RESEND_HISTORY_COOKIE = "confirm_resend_history";

/** Minimum gap between two resends from one browser. */
export const RESEND_COOLDOWN_SECONDS = 60;

/** How many resends one browser may ask for inside RESEND_WINDOW_SECONDS. */
export const RESEND_MAX_PER_WINDOW = 3;

/** The rolling window the count above applies to. */
export const RESEND_WINDOW_SECONDS = 3600; // 1 hour

/**
 * Nothing needs more than the window's worth of timestamps, and a cookie
 * that grows without a ceiling is a header-size bug waiting to happen.
 */
const MAX_HISTORY_ENTRIES = RESEND_MAX_PER_WINDOW + 1;

export type ResendDecision =
  | { allowed: true }
  | {
      allowed: false;
      /** Whole seconds the caller must wait. Always at least 1. */
      retryAfterSeconds: number;
      /** Which limit bit. Carried so the copy can differ if it ever needs to. */
      reason: "cooldown" | "window";
    };

/**
 * Read a history cookie into timestamps. Total: any value that is not a
 * finite, non-negative number is dropped rather than throwing, because this
 * string arrives from a browser and a malformed one must never be able to
 * take the page down.
 */
export function parseSendHistory(value: string | null | undefined): number[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .slice(0, MAX_HISTORY_ENTRIES);
}

/** The cookie value for a set of timestamps. */
export function encodeSendHistory(history: readonly number[]): string {
  return history.map((n) => String(Math.floor(n))).join(",");
}

/** Drop everything that has aged out of the window, newest first. */
function withinWindow(history: readonly number[], now: number): number[] {
  return history
    .filter((sentAt) => sentAt <= now && now - sentAt < RESEND_WINDOW_SECONDS)
    .sort((a, b) => b - a);
}

/**
 * May this browser ask for another link right now?
 *
 * Both limits are evaluated and the longer wait wins, so a caller who is
 * inside the cooldown AND out of sends is told the truth rather than the
 * more flattering half of it.
 *
 * A timestamp in the future is treated as if it had aged out: the clock it
 * came from is not ours, and refusing on it would let a skewed cookie lock
 * the control permanently.
 */
export function resendDecision(
  history: readonly number[],
  now: number
): ResendDecision {
  const recent = withinWindow(history, now);

  let retryAfter = 0;
  let reason: "cooldown" | "window" = "cooldown";

  const last = recent[0];
  if (last !== undefined) {
    const cooldownLeft = RESEND_COOLDOWN_SECONDS - (now - last);
    if (cooldownLeft > 0) {
      retryAfter = cooldownLeft;
      reason = "cooldown";
    }
  }

  const oldest = recent[recent.length - 1];
  if (recent.length >= RESEND_MAX_PER_WINDOW && oldest !== undefined) {
    // Once the oldest of the last N sends ages out of the window there is
    // room for another, so that is when the ceiling lifts.
    const windowLeft = RESEND_WINDOW_SECONDS - (now - oldest);
    if (windowLeft > retryAfter) {
      retryAfter = windowLeft;
      reason = "window";
    }
  }

  if (retryAfter <= 0) return { allowed: true };
  return { allowed: false, retryAfterSeconds: Math.ceil(retryAfter), reason };
}

/** The history to store after a send at `now`. */
export function recordSend(
  history: readonly number[],
  now: number
): number[] {
  return [Math.floor(now), ...withinWindow(history, now)].slice(
    0,
    MAX_HISTORY_ENTRIES
  );
}

/**
 * THE ONE SENTENCE A RESEND EVER REPORTS, whatever actually happened.
 *
 * It lives here rather than in the action so the screens can render it
 * without importing a "use server" module, and so there is exactly one
 * string to check when someone asks what this flow discloses. The reasoning
 * behind its deliberate vagueness is in
 * app/(auth)/resend-actions.ts's header.
 */
export const RESEND_SENT_MESSAGE =
  "If that address is waiting on confirmation, a new link is on its way. The link is single-use, so use the newest one.";

/**
 * The sentence for a refused resend. Rounded up to whole minutes above a
 * minute, because "wait 2,431 seconds" is a number nobody acts on.
 */
export function resendWaitMessage(retryAfterSeconds: number): string {
  if (retryAfterSeconds <= 90) {
    const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
    return `Wait ${seconds} second${seconds === 1 ? "" : "s"} before asking for another link.`;
  }
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return `Wait ${minutes} minutes before asking for another link.`;
}
