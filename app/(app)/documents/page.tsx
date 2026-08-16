import NextLink from "next/link";
import { LAlert, LCard, LEmpty, LPill, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatDate } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { loadOptionLabels } from "@/lib/custom-options-read";
import { EXPIRY_LADDER_BADGE, EXPIRY_NO_DATE_BADGE, type ExpiryTone } from "./expiry-badge";
import type { Database } from "@/lib/supabase/database.types";

export const metadata = { title: "Documents" };

type DocumentRow = Database["pilot"]["Tables"]["documents"]["Row"];
type ExpirationRow = Database["pilot"]["Views"]["expirations"]["Row"];

function daysRemainingLabel(days: number): string {
  if (days < 0) return `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  if (days === 0) return "Expires today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}

// expiry-badge.ts keeps its tones in the shared Radix Badge vocabulary
// (red/amber/green/gray) — it is imported by this screen and by
// overview/page.tsx, so it stays that way rather than being retyped for
// this one caller. This is the same one-line translation invoices/page.tsx
// keeps for its own STATUS_BADGE dictionary: red->crit, amber->warn,
// green->good, gray->neutral.
function toneToPillTone(tone: ExpiryTone): "crit" | "warn" | "good" | "neutral" {
  switch (tone) {
    case "red":
      return "crit";
    case "amber":
      return "warn";
    case "green":
      return "good";
    default:
      return "neutral";
  }
}

// D3: 61.23 medical duration and 61.56's 24-calendar-month flight review
// both run through the LAST DAY OF THE EXPIRING MONTH, not the exam-date
// anniversary — but pilot.documents stores whatever date the pilot typed
// (kinds.ts is deliberate about that; no duration is computed here). A
// day-precision "Expired 3 days ago" / "Expires today" on THESE two kinds
// tells a pilot who entered the anniversary date, not the month end, that
// they're expired up to ~30 days before they actually are. Rather than
// inventing a month-end derivation the schema doesn't support, this just
// says plainly what the countdown is actually measuring for these kinds.
const MONTH_SEMANTICS_KINDS = new Set(["medical", "flight_review"]);

export default async function DocumentsPage() {
  const { account } = await requireAccount("/documents");

  const supabase = await createClient();
  // pilot.expirations is read for its ladder math (days_remaining,
  // ladder_stage) — the point of this screen is to never recompute that
  // in TypeScript, per the migration's "one definition of due soon" rule.
  // .eq("account_id", ...) here is defence in depth, not the boundary —
  // RLS (security_invoker on the view, scoped by the underlying table's
  // policies) is what actually restricts the rows.
  // kindLabels resolves EVERY stored kind, retired ones included — this
  // is a history screen, and a document filed under a kind the pilot has
  // since retired must still render under its name rather than its key.
  const [
    { data: documentData, error },
    { data: expirationData, error: expirationError },
    kindLabels,
  ] = await Promise.all([
    supabase.from("documents").select("*"),
    supabase
      .from("expirations")
      .select("*")
      .eq("account_id", account.id)
      .eq("source_table", "document"),
    loadOptionLabels("document_kind"),
  ]);

  const documents = (documentData ?? []) as DocumentRow[];
  const expirationByDocId = new Map(
    ((expirationData ?? []) as ExpirationRow[]).map((row) => [row.source_id, row])
  );

  // Soonest-expiring first; a document with no expiry sorts LAST, not
  // first — an undated record isn't more urgent than one that's overdue.
  const sorted = [...documents].sort((a, b) => {
    const ea = expirationByDocId.get(a.id);
    const eb = expirationByDocId.get(b.id);
    if (ea && eb) return ea.days_remaining - eb.days_remaining;
    if (ea && !eb) return -1;
    if (!ea && eb) return 1;
    return a.label.localeCompare(b.label);
  });

  const overdueCount = [...expirationByDocId.values()].filter(
    (e) => e.ladder_stage === "overdue"
  ).length;
  const dueSoonCount = [...expirationByDocId.values()].filter((e) =>
    ["t_minus_1", "t_minus_7", "t_minus_14", "t_minus_30"].includes(e.ladder_stage)
  ).length;

  const anyError = error || expirationError;

  return (
    <LPageShell
      title="Documents"
      subtitle={
        anyError
          ? "Couldn't load your documents."
          : overdueCount
            ? `${overdueCount} expired · ${dueSoonCount} due soon`
            : dueSoonCount
              ? `${dueSoonCount} due soon`
              : `${documents.length} document${documents.length === 1 ? "" : "s"} on file`
      }
      action={
        <NextLink href="/documents/new" className={lButtonClass({ variant: "primary" })}>
          Add document
        </NextLink>
      }
    >
      {anyError ? (
        <LAlert tone="crit" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-crit" />
          <span>{friendlyDbError(error ?? expirationError, "documents.select")}</span>
        </LAlert>
      ) : (
        <LCard>
          {sorted.length === 0 ? (
            <LEmpty
              title="No documents yet"
              action={
                <NextLink href="/documents/new" className={lButtonClass({ variant: "primary" })}>
                  Add your first document
                </NextLink>
              }
            >
              Medicals, flight reviews, passports, certificates, insurance and
              W-9s: anything with a date that matters.
            </LEmpty>
          ) : (
            <LTable>
              <caption>
                <span className="sr-only">Documents</span>
              </caption>
              <thead>
                <tr>
                  <LTh>Document</LTh>
                  <LTh>Kind</LTh>
                  <LTh>Expires</LTh>
                  <LTh>Status</LTh>
                  <LTh>File</LTh>
                </tr>
              </thead>
              <tbody>
                {sorted.map((doc) => {
                  const expiration = expirationByDocId.get(doc.id);
                  const badge = expiration
                    ? EXPIRY_LADDER_BADGE[expiration.ladder_stage] ?? EXPIRY_NO_DATE_BADGE
                    : EXPIRY_NO_DATE_BADGE;
                  return (
                    <tr key={doc.id}>
                      {/* Table row-header idiom (invoices/page.tsx, the
                          public packet page): the first cell of each data
                          row is a scoped <th>, not an LTd. */}
                      <th
                        scope="row"
                        className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                      >
                        <NextLink
                          href={`/documents/${doc.id}`}
                          className="text-accent hover:underline"
                        >
                          {doc.label}
                        </NextLink>
                      </th>
                      <LTd>
                        <span className="text-ink-2">{kindLabels[doc.kind] ?? "Other"}</span>
                      </LTd>
                      <LTd>
                        <div className="flex flex-col">
                          <span className="tnum-l text-ink-2">{formatDate(doc.expires_on)}</span>
                          {expiration ? (
                            <span className="text-caption text-ink-3">
                              {daysRemainingLabel(expiration.days_remaining)}
                            </span>
                          ) : null}
                          {expiration && MONTH_SEMANTICS_KINDS.has(doc.kind) ? (
                            <span className="text-caption text-ink-3">
                              Counted against the date you entered. 61.23/61.56
                              actually run through the end of that month.
                            </span>
                          ) : null}
                        </div>
                      </LTd>
                      <LTd>
                        <LPill tone={toneToPillTone(badge.tone)}>{badge.label}</LPill>
                      </LTd>
                      <LTd>
                        <span className={doc.file_path ? "text-caption text-ink-2" : "text-caption text-crit"}>
                          {doc.file_path ? "Attached" : "None"}
                        </span>
                      </LTd>
                    </tr>
                  );
                })}
              </tbody>
            </LTable>
          )}
        </LCard>
      )}
    </LPageShell>
  );
}

/* ── Inline icon ───────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. Defined once here, aria-hidden, stroke="currentColor" so it
 * inherits its caller's tone utility (text-crit). Same shape as
 * invoices/page.tsx's own WarningIcon. */
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
