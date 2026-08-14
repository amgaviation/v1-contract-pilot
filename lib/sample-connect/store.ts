import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * ===========================================================================
 * SAMPLE CONNECT — the user → account mapping
 * ===========================================================================
 *
 * The one and only thing this sample persists. See the header of
 * supabase/migrations/20260814130000_sample_connect_accounts.sql for why it
 * is a table of its own and not `pilot.accounts.connect_account_id` (short
 * version: that column belongs to the production Connect integration and
 * putting a V2 account id in it would break real payment links).
 *
 * Everything else — onboarding progress, capability status, subscription
 * state — is read live from Stripe on every page load. That is a deliberate
 * choice for a sample: it keeps the data flow obvious and it cannot go stale.
 * A production integration would additionally cache status locally, updated
 * by the webhooks, so that a Stripe outage does not blank the dashboard.
 *
 * The table is not in `Database` (lib/supabase/database.types.ts is generated
 * for the product's own schema and this sample deliberately does not touch
 * that file), so the queries below go through an untyped client. The casts
 * are confined to this module.
 */

type SampleAccountRow = {
  user_id: string;
  stripe_account_id: string;
  livemode: boolean;
};

/** The Stripe account belonging to this user, or null if they have none yet. */
export async function getSampleAccountId(userId: string): Promise<string | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .schema("pilot")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("sample_connect_accounts" as any)
    .select("stripe_account_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    // A missing table is the expected error before the migration has been
    // applied, and saying so beats "relation does not exist" reaching the UI.
    if (error.code === "42P01") {
      throw new Error(
        "The sample_connect_accounts table does not exist yet. Apply " +
          "supabase/migrations/20260814130000_sample_connect_accounts.sql to your database " +
          "(supabase db push, or paste it into the SQL editor)."
      );
    }
    throw new Error(`Couldn't read the sample Connect account mapping: ${error.message}`);
  }

  return (data as { stripe_account_id: string } | null)?.stripe_account_id ?? null;
}

/**
 * Records the account this platform just created for a user.
 *
 * Insert-only by design (the migration grants no UPDATE): if a row already
 * exists, the caller should have used it instead of creating a second Stripe
 * account. A unique violation here means two onboarding clicks raced, and the
 * honest response is to keep the row that won and tell the caller.
 */
export async function saveSampleAccountId(params: {
  userId: string;
  stripeAccountId: string;
  livemode: boolean;
}): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const row: SampleAccountRow = {
    user_id: params.userId,
    stripe_account_id: params.stripeAccountId,
    livemode: params.livemode,
  };

  const { error } = await supabase
    .schema("pilot")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("sample_connect_accounts" as any)
    .insert(row as never);

  if (error) {
    if (error.code === "23505") {
      return {
        error:
          "This user already has a sample Stripe account. Reload the page — the existing one is still there.",
      };
    }
    return { error: `Couldn't save the Stripe account id: ${error.message}` };
  }

  return { error: null };
}
