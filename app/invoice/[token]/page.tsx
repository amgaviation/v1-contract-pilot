import { Suspense } from "react";
import { notFound } from "next/navigation";
import { LAlert, LCard, LPill, LSeparator, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/server";
import { isLiveMode } from "@/lib/stripe/server";
import { formatCents, formatDate } from "@/lib/format";
import { loadShareReceipts } from "@/lib/invoice-share-receipts";

export const dynamic = "force-dynamic";

/**
 * The CLIENT-FACING invoice — this product's first unauthenticated route
 * that exposes tenant data. Read supabase/migrations/20260809060000_
 * invoice_public_share.sql in full before touching this file; that
 * migration's `pilot.invoice_public` function is the entire access
 * boundary, and this page is a thin renderer of exactly what it returns.
 *
 * NO SESSION ASSUMED ANYWHERE IN THIS FILE: no `requireAccount`, no
 * `lib/supabase/account.ts` import, no read of `auth.getUser()`. The
 * Supabase client below is created the same way the authenticated screens
 * create theirs (`lib/supabase/server.ts`'s `createClient()` — it merely
 * binds to whatever cookies exist, session or none), but the ONLY call
 * made through it is `rpc("invoice_public", ...)`, which runs as `anon`
 * for a visitor with no session (the ordinary case here) and as
 * `authenticated` for a signed-in pilot previewing their own link — both
 * paths go through the identical SECURITY DEFINER function, so a pilot
 * previewing sees byte-for-byte what their client will.
 *
 * NO loading.tsx IN THIS DIRECTORY, DELIBERATELY (there used to be one).
 * A loading.tsx wraps a route's async Server Component in an automatic
 * Suspense boundary, which makes Next start STREAMING the response: the
 * shell flushes with an HTTP 200 before this function has run far enough
 * to reach either notFound() call below. Once that 200 is on the wire it
 * cannot become the 404 an invalid token deserves — the not-found copy
 * still streams in and renders correctly (Suspense delivers the
 * replacement content the moment it resolves, exactly as designed), only
 * the STATUS CODE is stuck at 200 for the rest of that response, which is
 * what a link-checker, monitoring probe, or crawler sees regardless of
 * what the rendered page says. Removing loading.tsx makes the whole
 * render synchronous — nothing reaches the client until this function
 * returns — so notFound() below can still set the real status. The cost
 * is that a client with a slow connection sees nothing at all, rather
 * than a spinner, while pilot.invoice_public resolves; accepted on
 * purpose, because this page is opened once from an emailed link and a
 * correct HTTP status matters more here than perceived latency on an RPC
 * that is ordinarily fast. app/packet/[token]/page.tsx makes the same
 * trade for the same reason and never had a loading.tsx to remove.
 *
 * FIELD-BY-FIELD JUSTIFICATION for every field `pilot.invoice_public`
 * returns and this page renders — the promised companion to that
 * migration's own header comment:
 *
 *   invoice.invoice_number  The document's own identifier. Already on
 *                           every PDF this pilot has ever sent.
 *   invoice.status          So a paid/partially-paid invoice says so
 *                           instead of asking to be paid again — the
 *                           "degrade honestly" requirement.
 *   invoice.issued_on/due_on  Ordinary invoice header facts.
 *   invoice.notes            Pilot-authored, ALREADY client-facing —
 *                           lib/invoice-pdf.tsx renders this exact field
 *                           in the PDF this pilot already sends by hand;
 *                           this is not a new disclosure, only a second
 *                           surface for one already-shared fact.
 *   account.legal_name/address*  The pilot's own business identity — the
 *                           client already knows who is billing them
 *                           (it's who they hired). NOT included: any
 *                           other `pilot.accounts` column — no plan,
 *                           status, seat_count, connect_account_id,
 *                           stripe_customer_id, trial_ends_at, or logo
 *                           (the PDF route's logo fetch needs a private-
 *                           bucket download this function deliberately
 *                           does not attempt — see that route's own
 *                           comment on why a logo failure must not break
 *                           rendering; the public page ships text-only
 *                           rather than add a second signed-URL surface
 *                           for this first version).
 *   client.name/contact_name/address*  The BILLED client's OWN name and
 *                           address — this is the invoice's "Bill To"
 *                           block, the client's own data being shown back
 *                           to them, the same fields (and ONLY these
 *                           fields — no contact_email/contact_phone, which
 *                           the PDF route doesn't select either) the PDF
 *                           already puts in their hands. NOT included:
 *                           anything that would let this client discover
 *                           this pilot's OTHER clients — there is no way
 *                           to reach any client row but this invoice's own
 *                           billed client, ever, from this function.
 *   lines[].description/quantity/unit_amount_cents/amount_cents  What was
 *                           billed, at the granularity the client already
 *                           agreed to pay. NOT included: line_type,
 *                           trip_id, expense_id, expense_treatment,
 *                           sort_order, id, created_at — none of that is
 *                           meaningful to the person paying the bill, and
 *                           expense_id/trip_id are internal foreign keys
 *                           into tables (pilot.expenses, pilot.trips) this
 *                           client must never be able to correlate against.
 *   totals.*                subtotal/tax/total/amount_paid/balance_due/
 *                           last_paid_on — pilot.invoice_totals is this
 *                           schema's single source for these figures (see
 *                           that view's own comment); reading it here
 *                           rather than re-deriving keeps the client-
 *                           facing total byte-for-byte identical to what
 *                           the pilot sees on their own screen.
 *   payment.url/livemode/amount_cents  The Stripe Payment Link, if one
 *                           exists — the whole point of this feature (see
 *                           PLAN.md decision #8). `url` is not a secret: it
 *                           is the exact string Stripe already hands
 *                           anyone who has it. `livemode` is compared
 *                           against isLiveMode() below, mirroring
 *                           PaymentPanel's own test/live guard, so a
 *                           test-mode link is never rendered as payable to
 *                           a real client. `amount_cents` (20260811010000)
 *                           is the balance the link was SNAPSHOTTED for at
 *                           generation time — a Payment Link prices off a
 *                           Stripe Price made once, at creation, and never
 *                           re-priced afterwards, so a link generated
 *                           against an earlier balance keeps charging that
 *                           earlier figure even after the balance changes
 *                           (a correction, a partial payment). Without this
 *                           field the page could only label the button
 *                           with balance_due_cents while the link itself
 *                           charged something else — one number shown, a
 *                           different one charged. `payable` below requires
 *                           amount_cents to equal the live balance, and the
 *                           button is labelled with amount_cents, never
 *                           balance_due_cents, so it can never state a
 *                           figure Stripe will not actually charge.
 *                           stripe_payment_link_id is deliberately NOT
 *                           returned — the client never needs Stripe's
 *                           internal object id, only the URL.
 *
 * Nothing about the ACCOUNT beyond what's on this one document, nothing
 * about any OTHER invoice, nothing about any OTHER client, no cost/margin
 * data (expenses.amount_cents as the PILOT paid it never appears here —
 * only the rebilled invoice_lines.amount_cents the CLIENT owes), no
 * expenses.treatment, no internal notes table, no logbook, no expirations.
 *
 * REBILLED-EXPENSE RECEIPTS, ADDED AFTER THE ABOVE WAS WRITTEN, and the
 * one place this page reaches past pilot.invoice_public.
 *
 * The field list above records that this page "ships text-only rather than
 * add a second signed-URL surface for this first version". That still holds
 * literally — there is STILL no signed URL on this page, and still none for
 * the logo. What changed is narrower: a pilot who fronts a hotel bill on a
 * client's trip rebills it, and the client's accounts-payable desk needs
 * the receipt against that line. The emailed PDF has carried those receipt
 * pages since commit fb1ea11; this page, which is the surface the client
 * actually clicks, showed the line and not the receipt. Same document, same
 * client, two different answers.
 *
 * So the receipts below come from lib/invoice-share-receipts.ts, and every
 * security question about them is answered in that module's header and in
 * supabase/migrations/20260813020000_invoice_share_receipts.sql — READ BOTH
 * before changing this section. In summary: a separate SECURITY DEFINER
 * function re-proves the token, the revocation and the invoice status on
 * every call; it is granted to service_role ONLY (anon's privileges are
 * completely unchanged by that migration, because a storage path is exactly
 * the kind of internal identifier the field list above refuses to disclose);
 * the bytes are inlined into THIS page rather than served from any
 * addressable URL, so no second bearer credential exists and nothing
 * survives a revoked share by even one request; and every failure renders
 * this page exactly as it rendered before the feature existed.
 *
 * WHY A <Suspense> BOUNDARY IS SAFE HERE WHEN loading.tsx WAS NOT. The note
 * above explains that a loading.tsx makes Next flush a 200 BEFORE this
 * function has run far enough to reach either notFound(), which permanently
 * costs an invalid token its 404. An INNER boundary is a different thing:
 * both notFound() calls run to completion inside this function before it
 * returns any JSX at all, so the status code is already decided by the time
 * anything streams. What the boundary buys is that fetching, decoding and
 * base64-ing a dozen receipt images does not sit between the client and the
 * bill they came to read — the invoice, the totals and the pay button paint
 * first, and the receipts arrive underneath.
 */

type PublicInvoice = {
  invoice: {
    invoice_number: string | null;
    status: "sent" | "partial" | "paid";
    issued_on: string | null;
    due_on: string | null;
    notes: string | null;
  };
  account: {
    legal_name: string;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
  };
  client: {
    name: string;
    contact_name: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
  };
  lines: {
    description: string;
    quantity: number;
    unit_amount_cents: number;
    amount_cents: number;
  }[];
  totals: {
    subtotal_cents: number;
    tax_cents: number;
    total_cents: number;
    amount_paid_cents: number;
    balance_due_cents: number;
    last_paid_on: string | null;
  };
  payment: {
    url: string | null;
    livemode: boolean | null;
    amount_cents: number | null;
  };
};

function addressLines(entity: {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
}): string[] {
  const lines: string[] = [];
  if (entity.address_line1) lines.push(entity.address_line1);
  if (entity.address_line2) lines.push(entity.address_line2);
  const cityLine = [entity.city, entity.state, entity.postal_code].filter(Boolean).join(", ");
  if (cityLine) lines.push(cityLine);
  if (entity.country) lines.push(entity.country);
  return lines;
}

// Tone follows Ledger's status-pill vocabulary, translated straight from
// the old blue/amber/green scheme rather than re-judged: blue (live,
// nothing wrong yet) -> neutral; amber (a balance still moving) -> warn;
// green (resolved) -> good. Same dictionary app/(app)/overview/page.tsx's
// ladderToPillTone uses for its own color-name translation.
const STATUS_LABEL: Record<string, { tone: "neutral" | "warn" | "good"; label: string }> = {
  sent: { tone: "neutral", label: "Awaiting payment" },
  partial: { tone: "warn", label: "Partially paid" },
  paid: { tone: "good", label: "Paid" },
};

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const supabase = await createClient();

  // A malformed/miscopied URL segment (wrong length, wrong charset) is
  // rejected here before ever reaching the database — cheap, and it means
  // the RPC only ever sees something shaped like a real token. This is
  // NOT the security boundary (pilot.invoice_public's own token match is),
  // only an early exit for the overwhelmingly common "link got truncated
  // in an email client" case.
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    notFound();
  }

  const { data, error } = await supabase.rpc("invoice_public", { p_token: token } as never);

  // A genuine query failure (network, database down) is a real error, not
  // a verdict on the token — rendered as a normal 500 by Next's error
  // boundary, distinct from the notFound() branch below, and the token
  // itself never appears in what gets thrown or logged.
  if (error) {
    throw new Error("Couldn't load this invoice right now.");
  }

  // null covers an unknown token, a revoked one, and an invoice that
  // reverted out of a shareable status — all three, identically, by
  // design (see the migration's own comment on pilot.invoice_public).
  if (!data) {
    notFound();
  }

  // VIEWED STAMP — only after invoice_public proved the token live, so an
  // invalid link 404s without ever attempting a write. The RPC
  // (pilot.invoice_share_mark_viewed, 20260812200000) re-proves validity
  // in its own body regardless — this ordering just spares the database a
  // second call on the 404 path, the same economy as the regex above.
  //
  // BEST-EFFORT, BY DESIGN: the stamp is bookkeeping for the pilot; the
  // render is the client's invoice. A failed stamp must never cost the
  // client their document, so the error is logged (code/message only —
  // NEVER the token, same rule as everywhere else in this route) and the
  // page renders anyway. And a stamp means only "this link was fetched
  // while valid" — link scanners and mail previewers GET pages too, which
  // is why the share panel's wording is "Viewed", a fact about the link,
  // not a claim about a human (see the migration header).
  const { error: viewedError } = await supabase.rpc("invoice_share_mark_viewed", {
    p_token: token,
  } as never);
  if (viewedError) {
    console.error(
      "[invoice-public] view stamp failed",
      viewedError.code ?? viewedError.message
    );
  }

  const invoice = data as unknown as PublicInvoice;
  const status = STATUS_LABEL[invoice.invoice.status] ?? STATUS_LABEL.sent!;

  // A stored Payment Link is priced once, at generation time, and never
  // re-priced — see this page's own header comment on payment.amount_cents.
  // "Live" here only means "exists and matches this deployment's Stripe
  // mode"; it says nothing about whether the price it charges still matches
  // what's owed, which is the separate check below.
  const linkLooksLive =
    invoice.payment.url !== null && invoice.payment.livemode === isLiveMode();
  // amount_cents === null covers a link generated before this column
  // existed (20260810010000) and never regenerated since — there is no way
  // to know what it charges without a Stripe round trip this page
  // deliberately doesn't make (see this file's own "no second signed-URL
  // surface" reasoning for the logo, above at lines 49-55; the same
  // tradeoff applies here), so an unknown snapshot is treated exactly like
  // a stale one: not payable. app/(app)/invoices/[id]/payment-panel.tsx's
  // PayOnlinePanel treats the same null the same way, so this page and the
  // pilot's own screen never disagree about whether a link is trustworthy.
  const linkCurrent =
    linkLooksLive &&
    invoice.payment.amount_cents !== null &&
    invoice.payment.amount_cents === invoice.totals.balance_due_cents;
  // The button must never state a figure Stripe will not actually charge —
  // gating on the snapshot matching the LIVE balance, not merely on a link
  // existing, is what closes that gap.
  const payable = invoice.totals.balance_due_cents > 0 && linkCurrent;
  // A link that exists and looks live but is priced for a different
  // balance than what's actually owed — a client paid $600 less than they
  // thought, or a pilot corrected a payment, without anyone regenerating
  // the link. The balance is still real and still owed; the client just
  // cannot be handed a button that would charge the wrong amount for it.
  const linkStale =
    invoice.totals.balance_due_cents > 0 && linkLooksLive && !linkCurrent;

  return (
    // Ledger's softer marketing variant, hand-painted (this page owns its
    // own ground rather than composing through LPageShell — see the
    // migration task header): bg-canvas root, more air than the app
    // (larger container padding, size-up'd card padding below) and
    // absolutely trust-first, since the reader is an AP clerk deciding
    // whether to pay, not the pilot.
    <div className="min-h-dvh bg-canvas font-ledger text-body text-ink">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <Logo />
          <LPill tone={status.tone}>{status.label}</LPill>
        </div>

        <LCard className="p-6 sm:p-8">
          <div className="mb-6 flex flex-wrap justify-between gap-6">
            <div>
              <div className="text-h3 font-bold text-ink">{invoice.account.legal_name}</div>
              {addressLines(invoice.account).map((line, i) => (
                <div key={i} className="text-body-s text-ink-2">
                  {line}
                </div>
              ))}
            </div>
            <div>
              <div className="text-caption font-semibold text-ink-3">Invoice</div>
              <div className="text-h3 font-bold text-ink">
                {invoice.invoice.invoice_number ?? "—"}
              </div>
              {invoice.invoice.issued_on ? (
                <div className="text-body-s text-ink-2">
                  Issued {formatDate(invoice.invoice.issued_on)}
                </div>
              ) : null}
              {invoice.invoice.due_on ? (
                <div className="text-body-s text-ink-2">
                  Due {formatDate(invoice.invoice.due_on)}
                </div>
              ) : null}
            </div>
          </div>

          <LSeparator className="my-6" />

          {/* "Bill to" always resolves — pilot.invoice_public coalesces
              the linked client's row with the invoice's own typed bill_to_*
              columns field by field (20260815100000), so invoice.client.name
              is never empty even for an invoice with no client row. This
              page renders whichever the database already picked; there is
              no client-side fallback to keep in sync with that migration. */}
          <div className="mb-6">
            <div className="mb-1 text-caption font-semibold text-ink-3">Bill to</div>
            <div className="text-body font-medium text-ink">{invoice.client.name}</div>
            {invoice.client.contact_name ? (
              <div className="text-body-s text-ink-2">Attn: {invoice.client.contact_name}</div>
            ) : null}
            {addressLines(invoice.client).map((line, i) => (
              <div key={i} className="text-body-s text-ink-2">
                {line}
              </div>
            ))}
          </div>

          <LTable className="mb-6">
            <thead>
              <tr>
                <LTh>Description</LTh>
                <LTh numeric>Qty</LTh>
                <LTh numeric>Rate</LTh>
                <LTh numeric>Amount</LTh>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line, i) => (
                <tr key={i}>
                  <LTd>{line.description}</LTd>
                  <LTd numeric>{line.quantity}</LTd>
                  <LTd numeric>{formatCents(line.unit_amount_cents)}</LTd>
                  <LTd numeric>{formatCents(line.amount_cents)}</LTd>
                </tr>
              ))}
            </tbody>
          </LTable>

          <div className="mb-6 flex flex-col items-end gap-1">
            {/* BALANCE DUE IS THE SOLE EMPHASIZED LINE. Bolding both Total
                and Balance due on a partially paid invoice put two
                equal-weight figures in front of a check-writer whose only
                question is "what do I owe now" — Total renders like
                Subtotal/Tax/Paid, and Balance due steps all the way up to
                Ledger's figure size (the same treatment LStat gives a
                headline number), still tabular via tnum-l, so it reads as
                the answer rather than merely more bold text next to bold
                text. */}
            <TotalsLine label="Subtotal" value={invoice.totals.subtotal_cents} />
            <TotalsLine label="Tax" value={invoice.totals.tax_cents} />
            <TotalsLine label="Total" value={invoice.totals.total_cents} />
            <TotalsLine label="Paid" value={invoice.totals.amount_paid_cents} />
            <TotalsLine label="Balance due" value={invoice.totals.balance_due_cents} emphasize />
          </div>

          {invoice.invoice.notes ? (
            <>
              <LSeparator className="my-6" />
              <p className="text-body-s text-ink-2">{invoice.invoice.notes}</p>
            </>
          ) : null}

          {payable ? (
            // Labelled with the LINK's own snapshotted amount, never
            // balance_due_cents — `payable` already proved the two are
            // equal, but the button states what Stripe will actually
            // charge, not what this page separately computed. THE ONE
            // FILLED ACCENT ACTION on this page — every other element
            // here is text, a pill, or a hairline, exactly as Ledger's
            // "one filled accent action per view" rule requires.
            <>
              <LSeparator className="my-6" />
              <a
                href={invoice.payment.url!}
                target="_blank"
                rel="noopener noreferrer"
                className={lButtonClass({ variant: "primary", size: "lg", className: "w-full" })}
              >
                Pay {formatCents(invoice.payment.amount_cents!)} online
              </a>
            </>
          ) : linkStale ? (
            <>
              <LSeparator className="my-6" />
              <LAlert tone="warn">
                Balance due: {formatCents(invoice.totals.balance_due_cents)}. The
                online payment link for this invoice is out of date. Contact
                your pilot for an updated one rather than using it.
              </LAlert>
            </>
          ) : null}
        </LCard>

        {/* APPENDED BELOW THE INVOICE, not folded into it — the same place
            the PDF puts them (receipt pages follow the invoice page). It
            also keeps the pay button where a client expects it instead of
            pushing it under a column of full-width images. */}
        <Suspense fallback={null}>
          <ShareReceipts token={token} />
        </Suspense>
      </div>
    </div>
  );
}

/**
 * The receipt pages, rendered from the same ReceiptAttachment shape the PDF
 * builds and captioned with the same line description and amount, so a
 * client comparing the two documents sees the same receipts, in the same
 * order, with the same explanation attached to any that could not be shown.
 *
 * `fallback={null}` above rather than a spinner: this is an appendix, and a
 * skeleton at the foot of a bill invites a client to wait for something
 * before paying. If there are no receipts (the common case — nothing
 * rebilled) that is also exactly what should render, so nothing about the
 * page moves.
 *
 * Renders NOTHING at all rather than an empty heading when there is nothing
 * to show — including on every failure path, which loadShareReceipts
 * flattens to an empty list on purpose (see its header: it will not assert
 * that receipts exist when the read that would have proved it failed).
 */
async function ShareReceipts({ token }: { token: string }) {
  const { attachments, omitted } = await loadShareReceipts(token);
  if (attachments.length === 0) return null;

  return (
    <div className="mt-6">
      <LCard className="p-6 sm:p-8">
        <h2 className="mb-1 text-h3 font-semibold text-ink">Receipts</h2>
        <p className="mb-6 text-body-s text-ink-2">
          Supporting the rebilled expenses on this invoice.
        </p>

        <div className="flex flex-col gap-6">
          {attachments.map((receipt, index) => (
            <div key={index}>
              <div className="mb-2 flex flex-wrap justify-between gap-3">
                <span className="text-body-s font-medium text-ink">{receipt.description}</span>
                {receipt.amountCents === null ? null : (
                  <span className="tnum-l text-body-s text-ink-2">
                    {formatCents(receipt.amountCents)}
                  </span>
                )}
              </div>
              {receipt.imageDataUri ? (
                // A plain <img>, deliberately. The source is a data: URI
                // built server-side this request, so there is no remote
                // fetch for next/image to optimise and no URL for it to
                // rewrite — putting the optimiser in front of it would only
                // add a second copy of bytes that are already in this
                // response. `alt` carries the caption for a reader who
                // cannot see the image; the caption above is not a
                // substitute, because a screen reader reaching the image
                // has already passed it.
                <img
                  src={receipt.imageDataUri}
                  alt={`Receipt for ${receipt.description}`}
                  className="block h-auto max-w-full"
                />
              ) : (
                // The same sentence lib/invoice-receipts.ts gives the PDF's
                // caption pages. Never rewritten here — one explanation,
                // whichever surface the client opened.
                <p className="text-body-s text-ink-2">{receipt.note}</p>
              )}
              {index < attachments.length - 1 ? <LSeparator className="mt-6" /> : null}
            </div>
          ))}
        </div>

        {omitted > 0 ? (
          // Stated, not silently dropped: a client counting rebilled lines
          // against receipts would otherwise find the page short with no way
          // to know whether the rest exist. Worded as "on file, available on
          // request" — the same promise receiptFallbackNote makes — rather
          // than pointing at the emailed PDF, because whether this reader
          // has that PDF, and whether it carried receipts at all (the send
          // dialog's checkbox), are both things this page cannot know.
          <p className="mt-6 text-body-s text-ink-2">
            {omitted === 1
              ? "One further receipt for a rebilled expense on this invoice is on file. A copy is available on request."
              : `${omitted} further receipts for rebilled expenses on this invoice are on file. Copies are available on request.`}
          </p>
        ) : null}
      </LCard>
    </div>
  );
}

function TotalsLine({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: number;
  /** Balance due only — steps the label to text-ink/semibold and the
   *  amount all the way up to Ledger's figure size, tnum-l and bold,
   *  the same shape LStat gives a headline number, so it reads as the
   *  answer next to the merely-regular lines around it. */
  emphasize?: boolean;
}) {
  return (
    <div className="flex min-w-56 justify-between gap-4">
      <span className={emphasize ? "text-body font-semibold text-ink" : "text-body-s text-ink-2"}>
        {label}
      </span>
      <span
        className={
          emphasize
            ? "tnum-l text-figure font-bold tracking-tight text-ink"
            : "tnum-l text-body-s text-ink-2"
        }
      >
        {formatCents(value)}
      </span>
    </div>
  );
}
