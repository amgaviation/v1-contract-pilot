"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";

export type ChartFormState = {
  error: string | null;
  values?: Record<string, string>;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KINDS = ["asset", "liability", "equity", "income", "expense"] as const;
type Kind = (typeof KINDS)[number];

function revalidateAccounting() {
  revalidatePath("/accounting");
  revalidatePath("/accounting/journal");
  revalidatePath("/reports/balance-sheet");
  revalidatePath("/reports/cash-flow");
}

export async function createChartAccount(
  _prev: ChartFormState,
  formData: FormData
): Promise<ChartFormState> {
  const { account } = await requireAccount("/accounting");

  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "").trim();
  const echo = { name, kind };

  if (!name) return { error: "Give the account a name.", values: echo };
  if (name.length > 120) {
    return { error: "Keep the account name under 120 characters.", values: echo };
  }
  if (!KINDS.includes(kind as Kind)) {
    return { error: "Pick what kind of account this is.", values: echo };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("accounts_chart")
    .insert({ account_id: account.id, name, kind: kind as Kind } as never);

  if (error) {
    return { error: friendlyDbError(error, "accounts_chart.insert"), values: echo };
  }
  revalidateAccounting();
  return { error: null };
}

export async function renameChartAccount(
  _prev: ChartFormState,
  formData: FormData
): Promise<ChartFormState> {
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Missing account id." };

  const { account } = await requireAccount("/accounting");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the account a name.", values: { name } };
  if (name.length > 120) {
    return { error: "Keep the account name under 120 characters.", values: { name } };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("accounts_chart")
    .update({ name } as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) {
    return { error: friendlyDbError(error, "accounts_chart.rename"), values: { name } };
  }
  if (count === 0) return { error: "That account no longer exists." };
  revalidateAccounting();
  return { error: null };
}

/**
 * Archive / unarchive. Archived accounts keep every posted line and keep
 * rendering in history and reports; they only stop being offered for new
 * lines. The database refuses archiving a system (seeded) account —
 * those are live posting targets — and that refusal is surfaced verbatim.
 */
export async function setChartAccountArchived(
  id: string,
  archived: boolean
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(id)) return { error: "Missing account id." };
  const { account } = await requireAccount("/accounting");

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("accounts_chart")
    .update({ archived_at: archived ? new Date().toISOString() : null } as never, {
      count: "exact",
    })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "accounts_chart.archive") };
  if (count === 0) return { error: "That account no longer exists." };
  revalidateAccounting();
  return { error: null };
}
