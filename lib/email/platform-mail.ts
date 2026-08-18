import { formatCentsPlain } from "@/lib/stripe/connect-payments";

/**
 * THE MAIL V1 ITSELF SENDS TO A PILOT about their own V1 subscription:
 * a receipt when a charge succeeds, an alert when one fails. Platform
 * voice, platform branding — the exact opposite of every client-facing
 * message in lib/email/, which goes out in the PILOT'S name and must
 * never carry V1's (lib/brand.ts states the rule; this file is the other
 * side of it).
 *
 * The HTML is the same email-safe card as supabase/templates/ — tables,
 * fully inline styles, the hosted PNG wordmark, the Ledger palette — and
 * for the same reasons that README lists: no <style> block survives Gmail
 * clipping, no external CSS, no webfonts, alt text when images are
 * blocked. The colour literals here are exempt from tokens:verify the way
 * the PDF renderers are: a mail client can never reach the app's compiled
 * stylesheet, so there is no token for this markup to use.
 *
 * PURE ON PURPOSE. No I/O, no environment, no server-only import, so
 * tests/platform-mail.test.mjs can pin the copy and both bodies directly.
 * The webhook (app/api/stripe/webhook/route.ts) does the sending.
 */

export type PlatformMail = {
  subject: string;
  /** Every mail this product sends is legible without HTML (lib/email/send.ts). */
  text: string;
  html: string;
};

const APP_ORIGIN = "https://v1.amgaviationgroup.com";
const BILLING_URL = `${APP_ORIGIN}/settings/billing`;

export type SubscriptionReceiptInput = {
  /** What was charged, in cents. From Stripe's invoice.amount_paid. */
  amountCents: number;
  /** Stripe's own invoice number ("A1B2C3D4-0007"), when the event carried one. */
  stripeInvoiceNumber: string | null;
  /** ISO date (YYYY-MM-DD) the charge landed, from the event's timestamp. */
  paidOnIso: string;
  /** Stripe's hosted invoice page, when the event carried one. */
  hostedInvoiceUrl: string | null;
};

export function buildSubscriptionReceipt(input: SubscriptionReceiptInput): PlatformMail {
  const amount = formatCentsPlain(input.amountCents);
  const date = readableDate(input.paidOnIso);
  const subject = `V1 receipt — ${amount}`;

  const rows: Array<[string, string]> = [["Amount", amount], ["Date", date]];
  if (input.stripeInvoiceNumber) rows.push(["Invoice", input.stripeInvoiceNumber]);

  const textLines = [
    `Your V1 subscription payment went through.`,
    ``,
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ``,
    ...(input.hostedInvoiceUrl ? [`Invoice: ${input.hostedInvoiceUrl}`, ``] : []),
    `Manage your plan: ${BILLING_URL}`,
  ];

  const html = card({
    preheader: `Payment received — ${amount}.`,
    heading: "Payment received",
    body: `Your V1 subscription payment went through.`,
    rows,
    button: input.hostedInvoiceUrl
      ? { label: "View invoice", url: input.hostedInvoiceUrl }
      : { label: "Manage billing", url: BILLING_URL },
    footNote: `Manage your plan any time at <a href="${BILLING_URL}" style="color:#23409c;">Settings &rarr; Billing</a>.`,
    footerReason:
      "You&rsquo;re receiving this because a payment was made on your V1 subscription.",
  });

  return { subject, text: textLines.join("\n"), html };
}

export type SubscriptionFailureInput = {
  /** The amount that failed to charge, in cents, when the event carried one. */
  amountCents: number | null;
  /** ISO date (YYYY-MM-DD) of the failed attempt. */
  attemptedOnIso: string;
  /** When Stripe scheduled another attempt: ISO date, else null (final attempt). */
  nextAttemptIso: string | null;
};

export function buildSubscriptionPaymentFailed(input: SubscriptionFailureInput): PlatformMail {
  const amount = input.amountCents === null ? null : formatCentsPlain(input.amountCents);
  const subject = "V1 payment failed — update your card";

  const retryLine = input.nextAttemptIso
    ? `We'll retry on ${readableDate(input.nextAttemptIso)}. Update your payment method before then to keep your account active.`
    : `Update your payment method to keep your account active.`;

  const bodyLine = amount
    ? `Your V1 subscription payment of ${amount} didn't go through.`
    : `Your V1 subscription payment didn't go through.`;

  const text = [bodyLine, ``, retryLine, ``, `Update your card: ${BILLING_URL}`].join("\n");

  const html = card({
    preheader: `Your V1 payment didn't go through.`,
    heading: "Payment failed",
    body: `${bodyLine} ${retryLine}`,
    rows: [],
    button: { label: "Update payment method", url: BILLING_URL },
    footNote: null,
    footerReason:
      "You&rsquo;re receiving this because a payment on your V1 subscription failed.",
  });

  return { subject, text, html };
}

/** "2026-08-17" -> "August 17, 2026". A malformed input passes through as-is. */
function readableDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const month = months[Number(m[2]) - 1];
  if (!month) return iso;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

/** HTML-escapes the four characters that matter in this markup. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The shared card. Same skeleton as supabase/templates/confirm-signup.html —
 * wordmark above a white card on the paper background, one heading, one
 * body line, an optional key/value block, one bulletproof button, footer.
 * `footNote` and `footerReason` are trusted markup written in this file;
 * everything else is escaped.
 */
function card(params: {
  preheader: string;
  heading: string;
  body: string;
  rows: Array<[string, string]>;
  button: { label: string; url: string };
  footNote: string | null;
  footerReason: string;
}): string {
  const rowsHtml = params.rows.length
    ? `<tr><td style="padding-bottom:28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f7f6f2; border:1px solid #e3e1da; border-radius:8px;">
          ${params.rows
            .map(
              ([k, v]) => `<tr>
            <td style="font-family:Arial, Helvetica, sans-serif; font-size:13px; line-height:20px; color:#8b92a3; padding:10px 16px; width:40%;">${esc(k)}</td>
            <td style="font-family:Arial, Helvetica, sans-serif; font-size:13px; line-height:20px; color:#16213a; padding:10px 16px; text-align:right; font-weight:bold;">${esc(v)}</td>
          </tr>`
            )
            .join("\n")}
        </table>
      </td></tr>`
    : "";

  const footNoteHtml = params.footNote
    ? `<tr><td style="font-family:Arial, Helvetica, sans-serif; font-size:13px; line-height:20px; color:#8b92a3; padding-top:28px;">${params.footNote}</td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>${esc(params.heading)}</title>
</head>
<body style="margin:0; padding:0; background-color:#f2f1ec; -webkit-text-size-adjust:100%;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">${esc(params.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f2f1ec;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px; max-width:100%;">
          <tr>
            <td style="padding:0 8px 20px 8px;">
              <img src="${APP_ORIGIN}/brand/navy.png" width="55" height="32" alt="V1" style="display:block; border:0; outline:none;" />
            </td>
          </tr>
          <tr>
            <td style="background-color:#ffffff; border:1px solid #e3e1da; border-radius:10px; padding:36px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:Arial, Helvetica, sans-serif; font-size:22px; line-height:28px; font-weight:bold; color:#16213a; padding-bottom:12px;">
                    ${esc(params.heading)}
                  </td>
                </tr>
                <tr>
                  <td style="font-family:Arial, Helvetica, sans-serif; font-size:15px; line-height:23px; color:#5a6377; padding-bottom:28px;">
                    ${esc(params.body)}
                  </td>
                </tr>
                ${rowsHtml}
                <tr>
                  <td>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background-color:#23409c; border-radius:8px;">
                          <a href="${esc(params.button.url)}" target="_blank" style="display:inline-block; padding:13px 28px; font-family:Arial, Helvetica, sans-serif; font-size:15px; font-weight:bold; color:#ffffff; text-decoration:none; border-radius:8px;">${esc(params.button.label)}</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                ${footNoteHtml}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 8px 0 8px; font-family:Arial, Helvetica, sans-serif; font-size:12px; line-height:18px; color:#8b92a3;">
              V1<br />
              ${params.footerReason}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
