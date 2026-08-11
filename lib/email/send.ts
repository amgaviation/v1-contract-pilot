import "server-only";
import { looksLikeEmail } from "./address";

// Re-exported so callers have one import for "send mail", while the guard
// itself stays in a module a plain Node test can load — see address.ts.
export { looksLikeEmail };

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

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

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

export async function sendEmail(message: Message): Promise<SendResult> {
  const config = readConfig();
  if ("error" in config) return { ok: false, error: config.error };

  if (!looksLikeEmail(message.to)) {
    return {
      ok: false,
      error: `"${message.to}" doesn't look like an email address, so nothing was sent.`,
    };
  }

  const body: Record<string, unknown> = {
    from: config.from,
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
    // A timeout and a DNS failure are different facts to the person
    // debugging, and neither is the pilot's fault — say which, and say
    // plainly that nothing was sent so they don't assume a duplicate risk.
    const reason =
      cause instanceof Error && cause.name === "TimeoutError"
        ? "the mail service didn't respond in time"
        : "the mail service couldn't be reached";
    return {
      ok: false,
      error: `Nothing was sent — ${reason}. Try again, or download the PDF and send it yourself.`,
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
      error: detail
        ? `Nothing was sent — the mail service refused it (${response.status}): ${detail}`
        : `Nothing was sent — the mail service refused it (${response.status}).`,
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
      error:
        "The mail service accepted the request but didn't confirm an id, so the send can't be treated as done. Check the invoice before sending again.",
    };
  }

  return { ok: true, id };
}
