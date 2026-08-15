/**
 * WHY THIS TYPE HAS A FILE OF ITS OWN, two lines long.
 *
 * lib/email/send.ts carries `server-only`, which is the point of it: nothing
 * that can reach a browser may import the module that holds the API key. But
 * the DISTINCTION it draws between a definite refusal and an indeterminate
 * result is not a secret and is not a server fact. It is a piece of the
 * product's vocabulary that lib/reminders/policy.ts has to reason about (only
 * one of the two may ever be retried) and that a plain Node test has to be
 * able to load, exactly as lib/email/address.ts already exists so the
 * address guard can be tested without dragging the sender in behind it.
 *
 * send.ts re-exports it, so callers still have one import for "send mail".
 */

/**
 *   'refused': NOTHING WAS SENT and the sender knows it: a 4xx/5xx from the
 *                mail service, an address that is not an address, a missing
 *                configuration, a connection that never opened. Trying again
 *                costs nothing and risks nothing.
 *   'unknown': the request went out and the response timed out, so the mail
 *                may already be queued. The endpoint has no idempotency key,
 *                so a retry is a second copy of the same message in somebody
 *                else's inbox. Never retried automatically, anywhere.
 */
export type SendFailureKind = "refused" | "unknown";
