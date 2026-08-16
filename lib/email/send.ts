import "server-only";
import { looksLikeEmail } from "./address";
import type { SendFailureKind } from "./failure-kind";

// Re-exported so callers have one import for "send mail", while the guard
// itself stays in a module a plain Node test can load (see address.ts). The
// failure kind is re-exported for the same reason and with the same shape:
// lib/reminders/policy.ts decides what may be retried and must be loadable
// without this module's API key handling coming with it.
export { looksLikeEmail };
export type { SendFailureKind };

/**
 * THE ONLY PLACE THIS PRODUCT SENDS MAIL.
 *
 * Why a fetch against Resend's REST API rather than the `resend` npm package:
 * the package buys nothing this needs. One POST with a JSON body is the whole
 * integration, and a dependency added for that is a dependency to audit,
 * update, and carry in the bundle forever. Eleven runtime dependencies is a
 * number this project has kept on purpose (see README).
 *
 * WHAT THIS FILE EXISTS TO PREVENT. Before it, `sendInvoice(id,
 * "platform_email")` set status='sent', stamped sent_at, recorded
 * delivery_method='platform_email' — and sent nothing. The schema had
 * anticipated the feature since the Phase 5 migration and the UI offered it,
 * so a pilot could choose "email it to my client", watch the invoice move to
 * Sent, and wait on a payment for a document that never left the building.
 * That is the silent-write-failure class docs/research/FLIGHTDEPTPRO-
 * INSPIRATION.md section A puts first, wearing its worst costume: not a
 * failure that looks like nothing happened, but one that looks like success.
 *
 * So the contract here is narrow and absolute: this function either hands the
 * message to Resend and gets an id back, or it returns an error that the
 * caller MUST surface. It never returns ok on a send it did not make, and it
 * never throws past the caller — a thrown error inside a server action becomes
 * an unhandled 500 and the pilot learns nothing.
 */

/**
 * WHY A FAILURE HAS A KIND, AND WHY EVERY CALLER THAT RETRIES MUST READ IT.
 *
 * `ok: false` covers two facts that are not the same fact, and the difference
 * decides whether trying again is free or dangerous:
 *
 *   'refused': nothing was sent, and this file knows it. A 4xx/5xx from
 *                Resend, an address that is not an address, a missing
 *                configuration, a connection that never opened, a 2xx with no
 *                id to show for it. Attempting the same send again costs
 *                nothing and risks nothing.
 *   'unknown': the request went out and the RESPONSE timed out, so the mail
 *                may already be queued and this code cannot tell. Resend has
 *                no idempotency key on this endpoint, so a retry here is a
 *                second copy of the same chase in somebody's client's inbox.
 *                Never retried automatically, anywhere.
 *
 * The `error` strings are unchanged and stay the user-facing account of what
 * happened; the kind is for code, which cannot be asked to parse prose.
 */
export type SendResult =
  | { ok: true; id: string }
  | { ok: false; kind: SendFailureKind; error: string };

export type Attachment = {
  filename: string;
  /** Raw bytes. Base64-encoded here, once, so no caller has to remember to. */
  content: Buffer;
};

export type Message = {
  to: string;
  subject: string;
  /** Plain text. Every mail this product sends is legible without HTML. */
  text: string;
  html?: string;
  replyTo?: string;
  attachments?: Attachment[];
  /**
   * The display name on the From line — the pilot's own business name, so a
   * client's inbox shows who actually billed them rather than this
   * product's name or a bare address. See sendInvoiceEmail/sendEstimateEmail
   * for where this is resolved (pilot.accounts.legal_name, the same name the
   * message body signs with). Omitted only when the caller has no name to
   * give, in which case Resend falls back to whatever display name is
   * configured on INVOICE_FROM_EMAIL itself.
   */
  fromName?: string;
};

const ENDPOINT = "https://api.resend.com/emails";

/**
 * A send takes real network time and an invoice PDF is not small. Ten seconds
 * is long enough for a legitimate slow response and short enough that a server
 * action does not hang until the platform's own limit kills it — which would
 * present to the pilot as a dead page rather than as a failed send.
 */
const TIMEOUT_MS = 10_000;

/**
 * Configuration is read per-call rather than cached at module load. A cached
 * read taken during a cold start with the variable briefly absent would poison
 * every later send in that instance, and this is not hot enough for the cost
 * to matter.
 *
 * Both names are read from the environment; no value appears in this repo.
 * RESEND_API_KEY is the account credential. INVOICE_FROM_EMAIL is the sender,
 * which MUST be on a domain verified at Resend — an unverified sender is
 * rejected with a 403 and is the single most likely reason a send fails in
 * this project today.
 */
function readConfig(): { key: string; from: string } | { error: string } {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.INVOICE_FROM_EMAIL;

  if (!key && !from) {
    return {
      error:
        "Email isn't configured yet, so nothing was sent. RESEND_API_KEY and INVOICE_FROM_EMAIL both need setting before invoices can be emailed. You can still download the PDF and send it yourself.",
    };
  }
  if (!key) {
    return {
      error:
        "Email isn't configured yet, so nothing was sent. RESEND_API_KEY needs setting. You can still download the PDF and send it yourself.",
    };
  }
  if (!from) {
    return {
      error:
        "Email isn't configured yet, so nothing was sent. INVOICE_FROM_EMAIL needs setting to a verified sending address. You can still download the PDF and send it yourself.",
    };
  }
  return { key, from };
}

/** Whether a send can be attempted at all — for hiding UI that cannot work. */
export function emailIsConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.INVOICE_FROM_EMAIL);
}

/**
 * "Name <address>" for the From header — RFC 5322's quoted-display-name
 * form, since a business name is free text a pilot typed and may contain a
 * comma, a quote, or nothing printable at all. A blank/whitespace-only name
 * is treated as absent rather than sent as `"" <email>`, which some clients
 * render literally. `"` and `\` are backslash-escaped, the two characters
 * quoted-string syntax requires it for; nothing else needs it inside quotes.
 */
function formatFrom(address: string, name: string | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) return address;
  const escaped = trimmed.replace(/(["\\])/g, "\\$1");
  return `"${escaped}" <${address}>`;
}

export async function sendEmail(message: Message): Promise<SendResult> {
  const config = readConfig();
  if ("error" in config) return { ok: false, kind: "refused", error: config.error };

  if (!looksLikeEmail(message.to)) {
    return {
      ok: false,
      kind: "refused",
      error: `"${message.to}" doesn't look like an email address, so nothing was sent.`,
    };
  }

  const body: Record<string, unknown> = {
    from: formatFrom(config.from, message.fromName),
    to: [message.to.trim()],
    subject: message.subject,
    text: message.text,
  };
  if (message.html) body.html = message.html;
  if (message.replyTo) body.reply_to = message.replyTo;
  if (message.attachments?.length) {
    body.attachments = message.attachments.map((a) => ({
      filename: a.filename,
      content: a.content.toString("base64"),
    }));
  }

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    // A TIMEOUT AND A CONNECTION FAILURE ARE NOT THE SAME FACT, and the
    // difference decides what the pilot should do next.
    //
    // If the connection never opened, nothing was sent and retrying is free.
    // If the request was accepted and the RESPONSE timed out, the mail may
    // already be queued — this code cannot tell. An earlier version of this
    // branch said "Nothing was sent" for both and invited another attempt,
    // which is how a client ends up with two copies of the same invoice. It
    // asserted a fact it did not have.
    //
    // Resend has no idempotency key on this endpoint, so the honest move is
    // to report the outcome as UNKNOWN and hand the judgement to the person
    // who can check — the pilot, who can look at their sent folder or simply
    // ask their client. Never claim a send did not happen when the truth is
    // that we stopped listening.
    if (cause instanceof Error && cause.name === "TimeoutError") {
      return {
        ok: false,
        kind: "unknown",
        error:
          "The mail service didn't respond in time, so this may or may not have been sent. Check with your client before sending it again, and mark the invoice's status by hand if it did arrive.",
      };
    }
    return {
      ok: false,
      kind: "refused",
      error:
        "Nothing was sent. The mail service couldn't be reached. Try again, or download the PDF and send it yourself.",
    };
  }

  if (!response.ok) {
    // Resend returns a JSON body with a `message` on every error worth
    // reading. Surfacing it matters more than tidiness here: "The
    // domain is not verified" is the difference between a five-minute DNS
    // fix and an afternoon of guessing, and a generic "send failed" hides
    // exactly that. Status is included because 403 and 422 send the
    // reader to different places.
    let detail = "";
    try {
      const payload = (await response.json()) as { message?: string; name?: string };
      detail = payload?.message ?? payload?.name ?? "";
    } catch {
      detail = "";
    }
    return {
      ok: false,
      kind: "refused",
      error: detail
        ? `Nothing was sent. The mail service refused it (${response.status}): ${detail}`
        : `Nothing was sent. The mail service refused it (${response.status}).`,
    };
  }

  // A 2xx with no id is not a send this code is willing to call successful.
  // PostgREST taught this repo the same lesson about `count: null` — an
  // absent confirmation is not a confirmation.
  let id = "";
  try {
    const payload = (await response.json()) as { id?: string };
    id = payload?.id ?? "";
  } catch {
    id = "";
  }
  if (!id) {
    return {
      ok: false,
      // REFUSED, not unknown, and the distinction is worth stating. A 2xx
      // means Resend accepted the request, so something may well be on its
      // way, but the id is this product's only evidence of a send, and
      // without one the row could not be written even if it wanted to be
      // (the ledger's CHECK requires the id). It is treated as a definite
      // non-send so the rung can be tried again; the error string still
      // tells the pilot to check before sending by hand.
      kind: "refused",
      error:
        "The mail service accepted the request but didn't confirm an id, so the send can't be treated as done. Check the invoice before sending again.",
    };
  }

  return { ok: true, id };
}
