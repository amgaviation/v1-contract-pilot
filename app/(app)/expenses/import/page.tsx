import { LAlert, LCard } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import ImportWorkspace from "./import-workspace";
import { listBankAccounts } from "./actions";

export const metadata = { title: "Import statement" };

/**
 * Upload -> parse -> preview -> confirm. Parsing (lib/bank-import/*)
 * happens entirely in the browser; only the pilot's reviewed rows are
 * ever sent to the server (see ./actions.ts's confirmBankImport).
 * Confirming an import lands rows in `bank_transactions`, unreviewed —
 * it does NOT create any `expenses` rows. That happens one at a time in
 * /expenses/transactions, the review queue, never here.
 */
export default async function BankImportPage() {
  await requireEntitlement("bank_import", "/expenses/import");
  const { accounts, error } = await listBankAccounts();

  return (
    <LPageShell
      title="Import a bank or card statement"
      subtitle="Download a CSV, OFX, or QFX statement from your bank's online portal and bring it in. Nothing is added to your books until you review and categorize each transaction."
    >
      {error ? (
        <LCard>
          {/* listBankAccounts already runs error through friendlyDbError
              before returning it, so `error` here is a sentence, not a
              raw PostgREST message. */}
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>{error}</span>
          </LAlert>
        </LCard>
      ) : (
        <ImportWorkspace initialAccounts={accounts} />
      )}
    </LPageShell>
  );
}

/* ── Inline icon ───────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. */
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
