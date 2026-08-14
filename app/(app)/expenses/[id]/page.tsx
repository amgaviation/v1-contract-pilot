import { notFound } from "next/navigation";
import { Box, Card, Flex, Text } from "@/components/ui";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDate } from "@/lib/format";
import PageShell from "../../page-shell";
import ExpenseForm, { type ExpenseFormValues } from "../expense-form";
import { updateExpense } from "../actions";
import { loadTripOptions } from "../trip-options";
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
  const [{ data, error }, { trips, error: tripError }, categories] =
    await Promise.all([
      supabase.from("expenses").select("*").eq("id", id).maybeSingle(),
      loadTripOptions(),
      loadOptionChoices("expense_category"),
    ]);

  // A failed query is not a missing expense — rendering a 404 would send
  // the pilot looking for a receipt they never lost.
  if (error) throw new Error(`Couldn't load expense ${id}: ${error.message}`);
  if (tripError) throw new Error(`Couldn't load your trips: ${tripError}`);

  const expense = data as (ExpenseFormValues & {
    id: string;
    incurred_on: string;
    amount_cents: number;
  }) | null;

  // Another tenant's id and a nonexistent one both return no row under
  // RLS, so a probe can't tell them apart.
  if (!expense) notFound();

  return (
    <PageShell
      title={formatCents(expense.amount_cents)}
      subtitle={`${formatDate(expense.incurred_on)}${
        expense.vendor ? ` · ${expense.vendor}` : ""
      }`}
      action={<DeleteExpenseButton id={expense.id} />}
    >
      {expense.receipt_path ? (
        <Box mb="4">
          <Card size="3">
            <Flex justify="between" align="center" gap="4">
              <Text color="gray">
                A receipt is attached. It&rsquo;s stored privately. The link
                below works for one minute.
              </Text>
              <ReceiptLink path={expense.receipt_path} />
            </Flex>
          </Card>
        </Box>
      ) : null}

      <ExpenseForm
        action={updateExpense}
        trips={trips}
        categories={categories}
        values={expense}
        submitLabel="Save expense"
      />
    </PageShell>
  );
}
