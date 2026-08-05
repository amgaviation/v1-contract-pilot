import { requireAccount } from "@/lib/supabase/account";
import PageShell from "../../page-shell";
import ExpenseForm from "../expense-form";
import { createExpense } from "../actions";
import { loadTripOptions } from "../trip-options";

export const metadata = { title: "Add expense" };

export default async function NewExpensePage() {
  await requireAccount("/expenses/new");

  const { trips, error } = await loadTripOptions();
  // A failed query would otherwise render an empty trip picker, which
  // reads as "you have no trips" and pushes the pilot into leaving the
  // receipt unfiled.
  if (error) throw new Error(`Couldn't load your trips: ${error}`);

  return (
    <PageShell
      title="Add expense"
      subtitle="Tag it once — rebill or deduct — and it files itself against the trip."
    >
      <ExpenseForm action={createExpense} trips={trips} submitLabel="Save expense" />
    </PageShell>
  );
}
