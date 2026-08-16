import { requireAccount } from "@/lib/supabase/account";
import { LPageShell } from "@/components/ledger/page-shell";
import ExpenseForm from "../expense-form";
import { createExpense } from "../actions";
import { loadClientOptions, loadTripOptions } from "../trip-options";
import { loadOptionChoices } from "@/lib/custom-options-read";

export const metadata = { title: "Add expense" };

export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ trip?: string; client?: string }>;
}) {
  await requireAccount("/expenses/new");
  const { trip: tripParam, client: clientParam } = await searchParams;

  const { trips, error } = await loadTripOptions();
  const { clients, error: clientsError } = await loadClientOptions();
  // The tenant's own category list. Never empty — choicesFor falls back
  // to the stock vocabulary if the options table can't be read, so a
  // settings-table blip can't stop a receipt being filed.
  const categories = await loadOptionChoices("expense_category");
  // A failed query would otherwise render an empty trip picker, which
  // reads as "you have no trips" and pushes the pilot into leaving the
  // receipt unfiled.
  if (error) throw new Error(`Couldn't load your trips: ${error}`);
  // Same reasoning one line up: an empty client picker reads as "you have
  // no clients" and would send the pilot away without attributing the cost.
  if (clientsError) throw new Error(`Couldn't load your clients: ${clientsError}`);

  // H8a: a pilot arriving from a just-finished trip shouldn't have to
  // re-pick it out of every trip they've ever flown. `trips` is already
  // scoped to the caller's account by RLS, so a match in that list IS the
  // membership check — an id for someone else's trip, or plain garbage,
  // simply isn't found here and is ignored rather than surfaced as an
  // error.
  const preselectedTripId =
    tripParam && trips.some((t) => t.id === tripParam) ? tripParam : undefined;

  // The same membership-by-list check for ?client=, which is how a pilot
  // arrives from a client's own cost panel to record a cost against them.
  // Ignored outright when ?trip= also named a trip: the trip decides the
  // client, and honouring both would offer a pairing the database refuses.
  const preselectedClientId =
    !preselectedTripId && clientParam && clients.some((c) => c.id === clientParam)
      ? clientParam
      : undefined;

  return (
    <LPageShell
      title="Add expense"
      subtitle="Tag it once as rebill or deduct. It files itself against the trip."
    >
      <ExpenseForm
        action={createExpense}
        trips={trips}
        clients={clients}
        categories={categories}
        values={{
          ...(preselectedTripId ? { trip_id: preselectedTripId } : {}),
          ...(preselectedClientId ? { client_id: preselectedClientId } : {}),
        }}
        submitLabel="Save expense"
      />
    </LPageShell>
  );
}
