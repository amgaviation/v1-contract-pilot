import { requireAccount } from "@/lib/supabase/account";
import PageShell from "../../page-shell";
import ExpenseForm from "../expense-form";
import { createExpense } from "../actions";
import { loadTripOptions } from "../trip-options";
import { loadOptionChoices } from "@/lib/custom-options-read";

export const metadata = { title: "Add expense" };

export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ trip?: string }>;
}) {
  await requireAccount("/expenses/new");
  const { trip: tripParam } = await searchParams;

  const { trips, error } = await loadTripOptions();
  // The tenant's own category list. Never empty — choicesFor falls back
  // to the stock vocabulary if the options table can't be read, so a
  // settings-table blip can't stop a receipt being filed.
  const categories = await loadOptionChoices("expense_category");
  // A failed query would otherwise render an empty trip picker, which
  // reads as "you have no trips" and pushes the pilot into leaving the
  // receipt unfiled.
  if (error) throw new Error(`Couldn't load your trips: ${error}`);

  // H8a: a pilot arriving from a just-finished trip shouldn't have to
  // re-pick it out of every trip they've ever flown. `trips` is already
  // scoped to the caller's account by RLS, so a match in that list IS the
  // membership check — an id for someone else's trip, or plain garbage,
  // simply isn't found here and is ignored rather than surfaced as an
  // error.
  const preselectedTripId =
    tripParam && trips.some((t) => t.id === tripParam) ? tripParam : undefined;

  return (
    <PageShell
      title="Add expense"
      subtitle="Tag it once as rebill or deduct. It files itself against the trip."
    >
      <ExpenseForm
        action={createExpense}
        trips={trips}
        categories={categories}
        values={preselectedTripId ? { trip_id: preselectedTripId } : {}}
        submitLabel="Save expense"
      />
    </PageShell>
  );
}
