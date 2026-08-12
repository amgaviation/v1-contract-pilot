import { requireAccount } from "@/lib/supabase/account";
import PageShell from "../../page-shell";
import ClientForm from "../client-form";
import { createClientRecord } from "../actions";

export const metadata = { title: "New client" };

export default async function NewClientPage() {
  const { account } = await requireAccount("/clients/new");

  return (
    <PageShell
      title="New client"
      subtitle="An owner, operator, or management company you fly for."
    >
      {/* Seeds the form's rate/terms fields from the account defaults the
          onboarding wizard collected (20260812400000) — editable starting
          text, not a hidden fallback: the pilot sees exactly what will be
          stored and can change it before saving. This is also how account
          terms reach invoices: due dates are snapshotted at issue from
          clients.payment_terms_days (phase5 migration's trigger), so
          seeding the CLIENT is the propagation point. Safe precisely
          because this page previously passed no `values` — the edit page
          (clients/[id]) passes the stored row and is untouched. Keys are
          mapped explicitly: the account column is default_payment_terms_
          days while the client column is payment_terms_days, so a spread
          would silently drop the terms. A null terms default falls
          through to the form's existing Net-30 fallback, matching the
          action's blank→30 parse. */}
      <ClientForm
        action={createClientRecord}
        submitLabel="Create client"
        values={{
          default_day_rate_cents: account.default_day_rate_cents,
          default_travel_day_rate_cents: account.default_travel_day_rate_cents,
          default_per_diem_cents: account.default_per_diem_cents,
          payment_terms_days: account.default_payment_terms_days,
        }}
      />
    </PageShell>
  );
}
