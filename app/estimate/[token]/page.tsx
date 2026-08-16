import { notFound } from "next/navigation";
import { LAlert, LCard, LPill, LSeparator, LTable, LTd, LTh } from "@/components/ledger";
import { Logo } from "@/components/ui/logo";
import { createClient } from "@/lib/supabase/server";
import { formatCents, formatDate } from "@/lib/format";
import RespondPanel from "./respond-panel";

export const dynamic = "force-dynamic";

/**
 * The CLIENT-FACING estimate — this product's second unauthenticated route
 * that exposes tenant data. Read
 * supabase/migrations/20260814111000_estimate_share.sql in full before
 * touching this file; pilot.estimate_public is the entire access boundary,
 * and this page is a thin renderer of exactly what it returns, mirroring
 * app/invoice/[token]/page.tsx's own structure and its own reasoning for
 * every choice below (repeated only where an estimate differs):
 *
 * NO SESSION ASSUMED, NO loading.tsx IN THIS DIRECTORY — same two reasons
 * as the invoice page: a loading.tsx would stream a 200 before either
 * notFound() below can run, permanently costing an invalid token its 404.
 *
 * FIELD-BY-FIELD: see pilot.estimate_public's own comment in the migration
 * for exactly which columns this function returns and why each one is
 * safe to show this specific client (their own name/address being read
 * back to them, this pilot's own business identity, and nothing about any
 * other estimate, invoice, or client).
 *
 * ACCEPT/DECLINE, THE ONE THING THIS PAGE CAN DO THAT app/invoice/[token]
 * CANNOT: pilot.estimates already has a client-answerable lifecycle (sent
 * -> accepted|declined, pilot.estimates_protect, 20260810060000) and today
 * the only way that answer reaches this schema is the pilot re-typing it.
 * RespondPanel below is rendered ONLY while status is 'sent' — matching
 * pilot.estimate_public_accept/_decline's own gate exactly, so the buttons
 * are never shown where the RPC would silently do nothing.
 */

type PublicEstimate = {
  estimate: {
    estimate_number: string | null;
    status: "sent" | "accepted" | "declined";
    issued_on: string | null;
    valid_until: string | null;
    terms: string | null;
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

// Same blue/green/red -> neutral/good/crit dictionary as
// app/invoice/[token]/page.tsx's STATUS_LABEL: blue (waiting, nothing
// wrong) -> neutral; green (resolved well) -> good; red (a negative
// resolution) -> crit.
const STATUS_LABEL: Record<string, { tone: "neutral" | "good" | "crit"; label: string }> = {
  sent: { tone: "neutral", label: "Awaiting your answer" },
  accepted: { tone: "good", label: "Accepted" },
  declined: { tone: "crit", label: "Declined" },
};

export default async function PublicEstimatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const supabase = await createClient();

  // Cheap early exit for a truncated/miscopied URL segment — NOT the
  // security boundary (pilot.estimate_public's own token match is).
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    notFound();
  }

  const { data, error } = await supabase.rpc("estimate_public", { p_token: token } as never);

  if (error) {
    throw new Error("Couldn't load this estimate right now.");
  }

  // null covers an unknown token, a revoked one, and a draft estimate —
  // all three, identically, by design (see the migration's own comment).
  if (!data) {
    notFound();
  }

  // VIEWED STAMP — best-effort, same reasoning as the invoice page: a
  // failed stamp must never cost the client their document.
  const { error: viewedError } = await supabase.rpc("estimate_share_mark_viewed", {
    p_token: token,
  } as never);
  if (viewedError) {
    console.error(
      "[estimate-public] view stamp failed",
      viewedError.code ?? viewedError.message
    );
  }

  const estimate = data as unknown as PublicEstimate;
  const status = STATUS_LABEL[estimate.estimate.status] ?? STATUS_LABEL.sent!;

  return (
    // Ledger's softer marketing variant, hand-painted — same posture as
    // app/invoice/[token]/page.tsx's own root: no PageShell, more air than
    // the app, trust-first because the reader is deciding whether to accept
    // a quote, not the pilot.
    <div className="min-h-dvh bg-canvas font-ledger text-body text-ink">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <Logo />
          <LPill tone={status.tone}>{status.label}</LPill>
        </div>

        <LCard className="p-6 sm:p-8">
          <div className="mb-6 flex flex-wrap justify-between gap-6">
            <div>
              <div className="text-h3 font-bold text-ink">{estimate.account.legal_name}</div>
              {addressLines(estimate.account).map((line, i) => (
                <div key={i} className="text-body-s text-ink-2">
                  {line}
                </div>
              ))}
            </div>
            <div>
              <div className="text-caption font-semibold text-ink-3">Estimate</div>
              <div className="text-h3 font-bold text-ink">
                {estimate.estimate.estimate_number ?? "—"}
              </div>
              {estimate.estimate.issued_on ? (
                <div className="text-body-s text-ink-2">
                  Sent {formatDate(estimate.estimate.issued_on)}
                </div>
              ) : null}
              {estimate.estimate.valid_until ? (
                <div className="text-body-s text-ink-2">
                  Valid until {formatDate(estimate.estimate.valid_until)}
                </div>
              ) : null}
            </div>
          </div>

          <LAlert tone="neutral" className="mb-6">
            This is a price quote, not an invoice. No payment is due.
          </LAlert>

          <LSeparator className="my-6" />

          <div className="mb-6">
            <div className="mb-1 text-caption font-semibold text-ink-3">Quote for</div>
            <div className="text-body font-medium text-ink">{estimate.client.name}</div>
            {estimate.client.contact_name ? (
              <div className="text-body-s text-ink-2">Attn: {estimate.client.contact_name}</div>
            ) : null}
            {addressLines(estimate.client).map((line, i) => (
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
              {estimate.lines.map((line, i) => (
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
            <TotalsLine label="Subtotal" value={estimate.totals.subtotal_cents} />
            <TotalsLine label="Tax" value={estimate.totals.tax_cents} />
            <TotalsLine label="Total" value={estimate.totals.total_cents} emphasize />
          </div>

          {estimate.estimate.terms ? (
            <>
              <LSeparator className="mb-3" />
              <div className="mb-1 text-caption font-semibold text-ink-3">Terms</div>
              <p className="text-body-s text-ink-2">{estimate.estimate.terms}</p>
            </>
          ) : null}

          {estimate.estimate.notes ? (
            <>
              <LSeparator className="my-3" />
              <p className="text-body-s text-ink-2">{estimate.estimate.notes}</p>
            </>
          ) : null}

          {estimate.estimate.status === "sent" ? (
            <>
              <LSeparator className="my-6" />
              <RespondPanel token={token} />
            </>
          ) : null}
        </LCard>
      </div>
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
  /** Total only — this page carries no "sole emphasized line" rule (there
   *  is no balance still owed to single out), so emphasize steps every part
   *  of the row to text-ink/semibold, the same weight app/invoice/[token]'s
   *  non-Balance-due lines use, rather than the figure-size jump reserved
   *  for a check-writer's balance due. */
  emphasize?: boolean;
}) {
  return (
    <div className="flex min-w-56 justify-between gap-4">
      <span className={emphasize ? "text-body font-semibold text-ink" : "text-body-s text-ink-2"}>
        {label}
      </span>
      <span
        className={
          emphasize ? "tnum-l text-body font-semibold text-ink" : "tnum-l text-body-s text-ink-2"
        }
      >
        {formatCents(value)}
      </span>
    </div>
  );
}
