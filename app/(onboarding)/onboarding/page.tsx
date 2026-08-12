import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/supabase/account";
import { DASHBOARD_PATH } from "@/lib/nav";
import { centsToInput } from "@/lib/format";
import OnboardingWizard, { type OnboardingValues } from "./onboarding-wizard";

export const metadata = { title: "Set up your account" };

/**
 * First-run setup, shown once after checkout provisions the tenant. A pilot
 * who has already finished (or skipped) it never sees it again — they are
 * sent straight to the dashboard. Everyone else fills in the three steps the
 * signup form deliberately left out (docs/PLAN.md hybrid onboarding): business
 * identity, airman profile, and the rate/billing defaults that pre-fill their
 * first trip and invoice.
 */
export default async function OnboardingPage() {
  const { account } = await requireAccount("/onboarding", {
    allowUnonboarded: true,
  });

  // Already done: nothing to collect, and the wizard is a one-time gate.
  if (account.onboarding_complete) redirect(DASHBOARD_PATH);

  // Prefill from whatever provisioning already seeded (legal_name, kind,
  // home_base from signup metadata) so the pilot confirms rather than retypes.
  const values: OnboardingValues = {
    legal_name: account.legal_name ?? "",
    dba_name: account.dba_name ?? "",
    phone: account.phone ?? "",
    home_base: account.home_base ?? "",
    address_line1: account.address_line1 ?? "",
    address_line2: account.address_line2 ?? "",
    city: account.city ?? "",
    state: account.state ?? "",
    postal_code: account.postal_code ?? "",
    country: account.country ?? "",
    certificate_type: account.certificate_type ?? "",
    certificate_number: account.certificate_number ?? "",
    ratings: account.ratings ?? "",
    default_day_rate: centsToInput(account.default_day_rate_cents),
    default_travel_day_rate: centsToInput(account.default_travel_day_rate_cents),
    default_per_diem: centsToInput(account.default_per_diem_cents),
    default_payment_terms_days:
      account.default_payment_terms_days == null
        ? ""
        : String(account.default_payment_terms_days),
    invoice_prefix: account.invoice_prefix ?? "",
  };

  return <OnboardingWizard values={values} kind={account.kind} />;
}
