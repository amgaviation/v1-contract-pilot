/**
 * How many rows one bulk confirm or dismiss will touch.
 *
 * Its own module, and not a constant in ./actions.ts, for a mechanical
 * reason: that file is `"use server"`, where every export must be an async
 * function — a shared number cannot live there. The review queue needs the
 * same figure to disable its buttons and say so BEFORE the pilot clicks,
 * rather than letting the action be the first thing that mentions a limit.
 *
 * The number itself is a duration budget, not a taste call. Bulk confirm
 * costs two round trips per row (the duplicate probe, then the atomic
 * confirm), so a hundred rows is a couple of seconds of server action with
 * a pending label on the button — and a three-month statement, the case
 * this whole feature exists for, clears in two passes instead of ~500
 * clicks. Raising it trades that pending time for fewer passes; the server
 * enforces the value either way (see readBulkIds), so the client cannot
 * quietly send more.
 */
export const MAX_BULK_TRANSACTIONS = 100;
