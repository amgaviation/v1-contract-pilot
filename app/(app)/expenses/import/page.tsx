import { Callout, Card } from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import PageShell from "../../page-shell";
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
    <PageShell
      title="Import a bank or card statement"
      subtitle="Download a CSV, OFX, or QFX statement from your bank's online portal and bring it in — nothing is added to your books until you review and categorize each transaction."
    >
      {error ? (
        <Card size="3">
          <Callout.Root color="red">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            {/* listBankAccounts already runs error through friendlyDbError
                before returning it, so `error` here is a sentence, not a
                raw PostgREST message. */}
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        </Card>
      ) : (
        <ImportWorkspace initialAccounts={accounts} />
      )}
    </PageShell>
  );
}
