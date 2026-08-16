import { notFound } from "next/navigation";
import { LCard } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDate } from "@/lib/format";
import ExpenseForm, { type ExpenseFormValues } from "../expense-form";
import { updateExpense } from "../actions";
import { loadClientOptions, loadTripOptions } from "../trip-options";
import { loadOptionChoices } from "@/lib/custom-options-read";
import DeleteExpenseButton from "./delete-expense-button";
import ReceiptLink from "./receipt-link";

export const metadata = { title: "Expense" };

export default async function ExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAccount(`/expenses/${id}`);

  const supabase = await createClient();
  const [
    { data, error },
    { trips, error: tripError },
    { clients, error: clientError },
    categories,
  ] = await Promise.all([
    supabase.from("expenses").select("*").eq("id", id).maybeSingle(),
    loadTripOptions(),
    loadClientOptions(),
    loadOptionChoices("expense_category"),
  ]);

  // A failed query is not a missing expense — rendering a 404 would send
  // the pilot looking for a receipt they never lost.
  if (error) throw new Error(`Couldn't load expense ${id}: ${error.message}`);
  if (tripError) throw new Error(`Couldn't load your trips: ${tripError}`);
  if (clientError) throw new Error(`Couldn't load your clients: ${clientError}`);

  const expense = data as (ExpenseFormValues & {
    id: string;
    incurred_on: string;
    amount_cents: number;
  }) | null;

  // Another tenant's id and a nonexistent one both return no row under
  // RLS, so a probe can't tell them apart.
  if (!expense) notFound();

  return (
    <LPageShell
      title={formatCents(expense.amount_cents)}
      subtitle={`${formatDate(expense.incurred_on)}${
        expense.vendor ? ` · ${expense.vendor}` : ""
      }`}
      action={<DeleteExpenseButton id={expense.id} />}
    >
      {expense.receipt_path ? (
        <LCard>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="text-ink-2">
              A receipt is attached. It&rsquo;s stored privately. The link
              below works for one minute.
            </span>
            <ReceiptLink path={expense.receipt_path} />
          </div>
        </LCard>
      ) : null}

      <ExpenseForm
        action={updateExpense}
        trips={trips}
        clients={clients}
        categories={categories}
        values={expense}
        submitLabel="Save expense"
      />
    </LPageShell>
  );
}
