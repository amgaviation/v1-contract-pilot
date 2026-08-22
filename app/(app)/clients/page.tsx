import NextLink from "next/link";
import { LAlert, LCard, LEmpty, LPill, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents } from "@/lib/format";
import { COUNTERPARTY_COPY, isInvoicedCounterparty } from "@/lib/counterparty";
import type { Database } from "@/lib/supabase/database.types";
import { friendlyDbError } from "@/lib/db-errors";
import { countOf } from "@/lib/supabase/rows";

type ClientRow = Database["pilot"]["Tables"]["clients"]["Row"];

export const metadata = { title: "Clients" };

// Supabase's Data API caps rows (commonly 1000) and TRUNCATES SILENTLY on
// a plain select — no error, just a shorter array. An explicit .limit
// makes that boundary visible instead of invisible. Same pattern as
// logbook/page.tsx's ENTRIES_LIMIT and page.tsx's AGGREGATE_LIMIT —
// copied, not reinvented.
const CLIENTS_LIMIT = 1000;

/**
 * W-9 status → pill tone. A missing W-9 is what the Overview "needs
 * attention" queue nags about, so it reads as a warning here rather than
 * as neutral information. Same crit/warn/good/neutral vocabulary as every
 * other migrated screen's own dictionary (invoices/page.tsx's
 * statusToPillTone).
 */
type W9Info = { tone: "neutral" | "good" | "warn" | "crit"; label: string };

const W9_BADGE_FALLBACK: W9Info = { tone: "crit", label: "No W-9" };
const W9_BADGE: Record<string, W9Info> = {
  on_file: { tone: "good", label: "W-9 on file" },
  requested: { tone: "warn", label: "W-9 requested" },
  not_requested: W9_BADGE_FALLBACK,
};

export default async function ClientsPage() {
  await requireAccount("/clients");

  const supabase = await createClient();
  // RLS scopes this to the caller's tenant; no account_id filter is
  // needed or wanted here (see the note in actions.ts).
  const [{ data, error }, tripCountRes] = await Promise.all([
    supabase
      .from("clients")
      .select("*")
      .order("archived_at", { ascending: true, nullsFirst: true })
      .order("name", { ascending: true })
      .limit(CLIENTS_LIMIT),
    // Getting Started step 2 ("Log your first trip") is only worth
    // pointing at from here once step 1 (this page) is done and step 2
    // genuinely isn't yet — a failed count must render nothing rather
    // than a nudge that could be wrong, same "unticked box from a failed
    // count is the reassuring-zero lie" rule overview/page.tsx follows.
    supabase.from("trips").select("id", { count: "exact", head: true }),
  ]);

  const clients = (data ?? []) as ClientRow[];
  const truncatedClients = clients.length === CLIENTS_LIMIT;
  const active = clients.filter((c) => !c.archived_at);
  const archived = clients.filter((c) => c.archived_at);
  const tripCount = countOf(tripCountRes);
  const showLogTripNudge = clients.length > 0 && tripCount.ok && tripCount.count === 0;

  return (
    <LPageShell
      title="Clients"
      subtitle={
        error
          ? "Couldn't load your clients."
          : `${active.length} active${archived.length ? `, ${archived.length} archived` : ""}`
      }
      action={
        <NextLink href="/clients/new" className={lButtonClass({ variant: "primary" })}>
          New client
        </NextLink>
      }
    >
      {truncatedClients ? (
        <LAlert tone="warn" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-warn" />
          <span>
            {`This list may be partial. There are more than ${CLIENTS_LIMIT} clients and only the first ${CLIENTS_LIMIT} are shown.`}
          </span>
        </LAlert>
      ) : null}

      <LCard>
        {error ? (
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>{friendlyDbError(error, "clients.select")}</span>
          </LAlert>
        ) : clients.length === 0 ? (
          <LEmpty
            title="No clients yet"
            action={
              <NextLink href="/clients/new" className={lButtonClass({ variant: "primary" })}>
                Add your first client
              </NextLink>
            }
          >
            Add the owner, operator, or management company you fly for. Trips
            and invoices both hang off a client.
          </LEmpty>
        ) : (
          <LTable>
            <caption>
              <span className="sr-only">Clients</span>
            </caption>
            <thead>
              <tr>
                <LTh>Client</LTh>
                <LTh>Contact</LTh>
                <LTh numeric>Day rate</LTh>
                <LTh numeric>Terms</LTh>
                <LTh>W-9</LTh>
                {/* Hidden visually but must still have an accessible name,
                    or the Edit-link column is unnamed to a screen reader. */}
                <LTh>
                  <span className="sr-only">Actions</span>
                </LTh>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => {
                const w9 = W9_BADGE[client.w9_status] ?? W9_BADGE_FALLBACK;
                return (
                  <tr key={client.id}>
                    <th
                      scope="row"
                      className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                    >
                      <NextLink href={`/clients/${client.id}`} className="text-accent hover:underline">
                        {client.name}
                      </NextLink>
                      {client.archived_at ? (
                        <div className="text-caption text-ink-3">Archived</div>
                      ) : null}
                    </th>
                    <LTd>
                      <div className="text-ink">{client.contact_name ?? "—"}</div>
                      <div className="text-caption text-ink-3">{client.contact_email ?? ""}</div>
                    </LTd>
                    <LTd numeric>
                      <span className="font-medium">{formatCents(client.default_day_rate_cents)}</span>
                    </LTd>
                    <LTd numeric>
                      <span className="text-ink-2">
                        {client.payment_terms_days === null ? "—" : `Net ${client.payment_terms_days}`}
                      </span>
                    </LTd>
                    <LTd>
                      {/* A W-9 is what a client needs from the pilot in
                          order to 1099 them for money paid. A client you
                          do not invoice is never paying you, so "No W-9"
                          in red is not a thing to chase, it is noise on
                          the queue that exists to make real ones visible.
                          The billing relationship is the fact worth
                          stating in this column instead. */}
                      {isInvoicedCounterparty(client) ? (
                        <LPill tone={w9.tone}>{w9.label}</LPill>
                      ) : (
                        <LPill tone="neutral">{COUNTERPARTY_COPY.badge}</LPill>
                      )}
                    </LTd>
                    <LTd numeric>
                      <NextLink
                        href={`/clients/${client.id}`}
                        aria-label={`Edit ${client.name}`}
                        className={lButtonClass({ variant: "outline", size: "sm" })}
                      >
                        Edit
                      </NextLink>
                    </LTd>
                  </tr>
                );
              })}
            </tbody>
          </LTable>
        )}
      </LCard>

      {showLogTripNudge ? (
        <p className="text-caption text-ink-3">
          Next:{" "}
          <NextLink href="/trips/new" className="text-accent hover:underline">
            log your first trip
          </NextLink>
          {" "}— its days become the invoice.
        </p>
      ) : null}
    </LPageShell>
  );
}

/* ── Inline icon ───────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. Same shape as invoices/page.tsx's own WarningIcon. */
function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 2 14.25 13H1.75Z" />
      <path d="M8 6.25v3" />
      <circle cx="8" cy="11.25" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
