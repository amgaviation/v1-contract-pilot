import NextLink from "next/link";
import { notFound } from "next/navigation";
import { LCard, LPill, LSeparator, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/server";
import { formatCents, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * The CLIENT-FACING vendor page — the per-client rollup a 135 operator's AP
 * desk wants instead of re-asking a pilot for the same information every
 * few weeks (research roadmap item #12). Read
 * supabase/migrations/20260814112000_client_vendor_page.sql IN FULL before
 * touching this file; pilot.client_vendor_page_public is the entire access
 * boundary and this page is a thin renderer of exactly what it returns —
 * same division of labor as app/invoice/[token]/page.tsx and
 * app/packet/[token]/page.tsx, which this file's structure mirrors
 * throughout.
 *
 * NO SESSION ASSUMED ANYWHERE HERE: no requireAccount, no account.ts
 * import, no auth.getUser(). The Supabase client binds to whatever cookies
 * exist; the only calls made through it are the two RPCs below, which run
 * as anon for a visitor and as authenticated for a pilot previewing their
 * own link — the identical SECURITY DEFINER functions either way, so a
 * preview shows exactly what the client will see.
 *
 * WHAT IS DELIBERATELY NOT HERE: invoice line items (that detail lives on
 * each invoice's own share link, not folded into a rollup), any other
 * client's data, draft/void invoices, and the packet's own document rows —
 * this page LINKS to /packet/[token] when one is live for this same client
 * rather than inlining its contents, so a change to what the packet exposes
 * never has to be mirrored here. It also never MINTS a packet link; if
 * packet_token comes back null, the honest answer is "ask your pilot," not
 * a button that would create one on this page's behalf.
 *
 * THE OPEN-INVOICE LINKS follow that same never-mint rule one level down
 * (20260822110000): each open row carries share_token, the token of that
 * invoice's OWN live share if the pilot already made one, and the invoice
 * number becomes a link to /invoice/[token] when it is present. A rollup
 * that names four open invoices and gives the reader no way to see what any
 * of them was for sends an AP clerk back to their inbox for links they were
 * already sent — which is the chore this page exists to end. Null stays
 * plain text: this page never manufactures a share the pilot didn't make.
 */

type VendorPage = {
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
  };
  open_invoices: {
    invoice_number: string | null;
    due_on: string | null;
    status: "sent" | "partial";
    balance_due_cents: number;
    /** This invoice's own live share token, or null when none exists. */
    share_token: string | null;
  }[];
  open_invoices_truncated: boolean;
  total_outstanding_cents: number;
  paid_invoices: {
    invoice_number: string | null;
    paid_on: string | null;
    total_cents: number;
  }[];
  paid_invoices_truncated: boolean;
  packet_token: string | null;
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

// Same blue/amber -> neutral/warn dictionary as
// app/invoice/[token]/page.tsx's STATUS_LABEL.
const OPEN_STATUS_LABEL: Record<string, { tone: "neutral" | "warn"; label: string }> = {
  sent: { tone: "neutral", label: "Awaiting payment" },
  partial: { tone: "warn", label: "Partially paid" },
};

type AutopayState = {
  available: boolean;
  enrolled: boolean;
  method_label: string | null;
} | null;

export default async function VendorPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  /** `autopay` — the return flag from the consent routes, display only. */
  searchParams: Promise<{ autopay?: string }>;
}) {
  const { token } = await params;
  const { autopay: autopayFlag } = await searchParams;

  const supabase = await createClient();

  // Same early-exit shape as app/invoice/[token]/page.tsx: not the
  // security boundary (pilot.client_vendor_page_public's own token match
  // is), only a cheap rejection of a truncated/miscopied URL segment
  // before it ever reaches the database.
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    notFound();
  }

  const { data, error } = await supabase.rpc("client_vendor_page_public", {
    p_token: token,
  } as never);

  // A genuine query failure is a real error, not a verdict on the token —
  // rendered as a normal 500, distinct from the notFound() branch below,
  // and the token itself never appears in what gets thrown or logged.
  // Matches app/invoice/[token]/page.tsx and app/packet/[token]/page.tsx's
  // documented position on the same trade.
  if (error) {
    throw new Error("Couldn't load this vendor page right now.");
  }

  // null covers an unknown token, a revoked one, and an expired one — all
  // three, identically, by design (see the migration's own comment on
  // pilot.client_vendor_page_public).
  if (!data) {
    notFound();
  }

  // VIEWED STAMP — only after the read above proved the token live, same
  // ordering and same best-effort reasoning as
  // app/invoice/[token]/page.tsx's own stamp: a failed stamp is bookkeeping
  // lost, never a reason to withhold the page from the client who is
  // waiting on it.
  const { error: viewedError } = await supabase.rpc("client_vendor_link_mark_viewed", {
    p_token: token,
  } as never);
  if (viewedError) {
    console.error(
      "[vendor-page] view stamp failed",
      viewedError.code ?? viewedError.message
    );
  }

  const page = data as unknown as VendorPage;

  // Autopay state, best-effort: a failed read renders the page without the
  // autopay card rather than withholding the rollup the client came for.
  // Same SECURITY DEFINER token boundary as the rollup itself
  // (pilot.autopay_public_state, 20260817160000).
  const { data: autopayData, error: autopayError } = await supabase.rpc(
    "autopay_public_state",
    { p_token: token } as never
  );
  if (autopayError) {
    console.error("[vendor-page] autopay state read failed", autopayError.code ?? autopayError.message);
  }
  const autopay = (autopayData ?? null) as AutopayState;

  return (
    // Ledger's softer marketing variant, hand-painted — same posture as
    // app/invoice/[token]/page.tsx's own root.
    <div className="min-h-dvh bg-canvas font-ledger text-body text-ink">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
        <div className="mb-8 flex items-center justify-between gap-3">
          <Logo href="/" />
        </div>

        <LCard className="mb-6 p-6 sm:p-8">
          <div className="mb-6 flex flex-wrap justify-between gap-6">
            <div>
              <div className="text-h3 font-bold text-ink">{page.account.legal_name}</div>
              {addressLines(page.account).map((line, i) => (
                <div key={i} className="text-body-s text-ink-2">
                  {line}
                </div>
              ))}
            </div>
            <div>
              <div className="text-caption font-semibold text-ink-3">Vendor page for</div>
              <div className="text-h3 font-bold text-ink">{page.client.name}</div>
            </div>
          </div>

          <LSeparator className="mb-6" />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-body font-medium text-ink">Total outstanding</span>
            <span className="tnum-l text-figure font-bold tracking-tight text-ink">
              {formatCents(page.total_outstanding_cents)}
            </span>
          </div>
        </LCard>

        <LCard className="mb-6 p-6 sm:p-8">
          <h2 className="mb-1 text-h3 font-semibold text-ink">Open invoices</h2>
          <p className="mb-6 text-body-s text-ink-2">Sent, awaiting payment.</p>

          {page.open_invoices.length === 0 ? (
            <p className="text-body-s text-ink-2">Nothing outstanding right now.</p>
          ) : (
            <LTable>
              <thead>
                <tr>
                  <LTh>Invoice</LTh>
                  <LTh>Due</LTh>
                  <LTh>Status</LTh>
                  <LTh numeric>Balance due</LTh>
                </tr>
              </thead>
              <tbody>
                {page.open_invoices.map((invoice, i) => {
                  const status = OPEN_STATUS_LABEL[invoice.status] ?? OPEN_STATUS_LABEL.sent!;
                  return (
                    <tr key={`${invoice.invoice_number}-${i}`}>
                      {/* scope="row": the row-header semantics the old
                          Table.RowHeaderCell carried, per the invoices
                          list idiom. The number is the link when this
                          invoice has a live share — same accent-text
                          treatment as "View the current paperwork" below,
                          not a second button: this table is a rollup to
                          scan, and four filled controls in a column would
                          out-shout the total the reader came for. */}
                      <th
                        scope="row"
                        className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                      >
                        {invoice.share_token ? (
                          <NextLink
                            href={`/invoice/${invoice.share_token}`}
                            className="text-accent hover:underline"
                          >
                            {invoice.invoice_number ?? "View invoice"}
                          </NextLink>
                        ) : (
                          (invoice.invoice_number ?? "—")
                        )}
                      </th>
                      <LTd>
                        <span className="text-ink-2">
                          {invoice.due_on ? formatDate(invoice.due_on) : "—"}
                        </span>
                      </LTd>
                      <LTd>
                        <LPill tone={status.tone}>{status.label}</LPill>
                      </LTd>
                      <LTd numeric>{formatCents(invoice.balance_due_cents)}</LTd>
                    </tr>
                  );
                })}
              </tbody>
            </LTable>
          )}
          {page.open_invoices_truncated ? (
            <p className="mt-3 text-caption text-ink-3">
              Showing the 200 soonest due. More are outstanding, and the total
              above includes all of them.
            </p>
          ) : null}
        </LCard>

        <LCard className="mb-6 p-6 sm:p-8">
          <h2 className="mb-1 text-h3 font-semibold text-ink">Payment history</h2>
          <p className="mb-6 text-body-s text-ink-2">Recently paid.</p>

          {page.paid_invoices.length === 0 ? (
            <p className="text-body-s text-ink-2">No payments on file yet.</p>
          ) : (
            <LTable>
              <thead>
                <tr>
                  <LTh>Invoice</LTh>
                  <LTh>Paid</LTh>
                  <LTh numeric>Amount</LTh>
                </tr>
              </thead>
              <tbody>
                {page.paid_invoices.map((invoice, i) => (
                  <tr key={`${invoice.invoice_number}-${i}`}>
                    {/* scope="row", same as the outstanding table above. */}
                    <th
                      scope="row"
                      className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                    >
                      {invoice.invoice_number ?? "—"}
                    </th>
                    <LTd>
                      <span className="text-ink-2">
                        {invoice.paid_on ? formatDate(invoice.paid_on) : "—"}
                      </span>
                    </LTd>
                    <LTd numeric>{formatCents(invoice.total_cents)}</LTd>
                  </tr>
                ))}
              </tbody>
            </LTable>
          )}
          {page.paid_invoices_truncated ? (
            <p className="mt-3 text-caption text-ink-3">Showing the 50 most recently paid.</p>
          ) : null}
        </LCard>

        {autopay?.available ? (
          <LCard className="mb-6 p-6 sm:p-8">
            <h2 className="mb-1 text-h3 font-semibold text-ink">Autopay</h2>
            {autopay.enrolled ? (
              <>
                <p className="mb-3 text-body-s text-ink-2">
                  Autopay is on. Recurring invoices from{" "}
                  {page.account.legal_name} are charged automatically to{" "}
                  <span className="font-medium text-ink">
                    {autopay.method_label ?? "your saved card"}
                  </span>
                  . One-off invoices still arrive as usual.
                </p>
                {autopayFlag === "saved" ? (
                  <p className="mb-3 text-body-s font-medium text-ink">
                    Your card was saved.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-4">
                  {/* Forms, not links: both change standing payment state,
                      and a GET a mail scanner can fire must not be able to
                      re-open a Stripe session or revoke a mandate. */}
                  <form action="/api/autopay/start" method="POST">
                    <input type="hidden" name="token" value={token} />
                    <button
                      type="submit"
                      className="text-body-s font-medium text-accent hover:underline"
                    >
                      Use a different card
                    </button>
                  </form>
                  <form action="/api/autopay/stop" method="POST">
                    <input type="hidden" name="token" value={token} />
                    <button
                      type="submit"
                      className="text-body-s font-medium text-accent hover:underline"
                    >
                      Turn autopay off
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <>
                <p className="mb-3 text-body-s text-ink-2">
                  {autopayFlag === "off"
                    ? `Autopay is off. Nothing will be charged automatically.`
                    : `Save a card once and recurring invoices from ${page.account.legal_name} are charged automatically when they're issued — no link to click, nothing to chase. You can turn it off here at any time.`}
                </p>
                {autopayFlag === "error" ? (
                  <p className="mb-3 text-body-s font-medium text-crit">
                    That didn&rsquo;t work. Try again in a moment.
                  </p>
                ) : null}
                {/* A REAL CONTROL, not a text link. This starts a Stripe
                    session that saves a card — the most consequential thing
                    anyone can do on this page — and it used to carry the
                    same weight and the same tap target as the passive
                    "View the current paperwork" link. OUTLINE, not filled:
                    the reader came here to see what they owe, and a filled
                    accent block would make enrolling in autopay look like
                    the page's purpose. The POST <form> wrapper stays exactly
                    as it was — see the GET-scanner note in the enrolled
                    branch above; a raw <button> with lButtonClass is how a
                    non-LButton element wears the Ledger skin (same idiom as
                    app/invoice/[token]/page.tsx's pay anchor). */}
                <form action="/api/autopay/start" method="POST">
                  <input type="hidden" name="token" value={token} />
                  <button
                    type="submit"
                    className={lButtonClass({ variant: "outline", size: "lg" })}
                  >
                    Set up autopay
                  </button>
                </form>
              </>
            )}
          </LCard>
        ) : null}

        {page.packet_token ? (
          <LCard className="mb-6 p-6 sm:p-8">
            <h2 className="mb-1 text-h3 font-semibold text-ink">Paperwork on file</h2>
            <p className="mb-3 text-body-s text-ink-2">
              W-9, certificate of insurance, and other documents shared with you.
            </p>
            <NextLink
              href={`/packet/${page.packet_token}`}
              className="text-body-s font-medium text-accent hover:underline"
            >
              View the current paperwork
            </NextLink>
          </LCard>
        ) : null}

        <p className="text-caption text-ink-3">
          This link was shared by {page.account.legal_name} and stops working
          on its own. If you need it again, ask them for a new one.
        </p>
      </div>
    </div>
  );
}
