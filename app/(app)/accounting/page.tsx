import NextLink from "next/link";
import {
  Button,
  Callout,
  Flex,
  Link as RadixLink,
  Text,
} from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import PageShell from "../page-shell";
import ChartManager from "./chart-manager";
import type { LedgerBalanceRow } from "./ledger-lib";
import { todayIso } from "../reports/sales-tax/report-lib";

export const metadata = { title: "Accounting" };

/**
 * The chart of accounts, with live balances. Loading this page first runs
 * pilot.ledger_sync — the on-demand derivation pass that turns invoices,
 * payments, expenses and mileage into ledger entries. It is idempotent by
 * unique index (see the 20260812100000 migration header), so running it
 * on every load is safe by construction; it is what keeps every balance
 * on this screen current with the facts recorded elsewhere in the app.
 */
export default async function AccountingPage() {
  const { account } = await requireAccount("/accounting");
  const supabase = await createClient();

  // `as never` on rpc args: the same hand-authored-types boundary cast the
  // rest of the app uses (see estimates/actions.ts convertEstimateToInvoice).
  const { error: syncError } = await supabase.rpc("ledger_sync", {
    target_account_id: account.id,
  } as never);

  const { data: balanceData, error: balanceError } = await supabase.rpc(
    "ledger_balances",
    { target_account_id: account.id, through_date: todayIso() } as never
  );

  const error = syncError?.message ?? balanceError?.message ?? null;
  const rows = (balanceData ?? []) as LedgerBalanceRow[];

  return (
    <PageShell
      title="Accounting"
      subtitle="Your chart of accounts, with balances derived from everything already recorded."
      action={
        <Flex gap="2">
          <Button asChild variant="soft" size="2">
            <NextLink href="/accounting/journal">Journal</NextLink>
          </Button>
          <Button asChild variant="soft" size="2">
            <NextLink href="/accounting/reconcile">Reconcile</NextLink>
          </Button>
        </Flex>
      }
    >
      {error ? (
        // A failed read renders as a failure, never as $0 balances —
        // lib/supabase/rows.ts discipline.
        <Callout.Root color="red">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            Couldn&rsquo;t load your ledger. The balances below are unavailable —
            nothing is shown rather than showing zeros that aren&rsquo;t true.
          </Callout.Text>
        </Callout.Root>
      ) : (
        <>
          <Text size="2" color="gray">
            Income, payments, expenses and mileage post here automatically —
            see the{" "}
            <RadixLink asChild>
              <NextLink href="/accounting/journal">journal</NextLink>
            </RadixLink>{" "}
            for every entry. Owner pay is tracked as draws (an equity
            account), the way a sole proprietor&rsquo;s books actually work — not
            payroll.
          </Text>
          <ChartManager rows={rows} />
        </>
      )}
    </PageShell>
  );
}
