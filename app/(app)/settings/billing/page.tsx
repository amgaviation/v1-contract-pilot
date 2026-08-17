import { LPageShell } from "@/components/ledger/page-shell";
import BillingPanel from "./billing-panel";

export const metadata = { title: "Billing" };

/**
 * The standalone billing route. This is where billing/actions.ts redirects
 * after a mutation (`/settings/billing?changed=...`), where a refused
 * write's read-only bounce lands (requireAccount's `state=read-only`), and
 * where Stripe's billing-portal/checkout return_url and success_url point
 * — so it stays a real, bookmarkable, deep-linkable page rather than
 * folding entirely into the Settings tab strip. The actual content is
 * billing-panel.tsx, shared with the "Billing" tab at
 * `/settings?tab=billing` (settings-tabs.tsx) so the two surfaces can
 * never show two different billing stories.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ changed?: string; state?: string }>;
}) {
  const { changed, state } = await searchParams;

  return (
    <LPageShell
      title="Billing"
      subtitle="Your plan, what it includes, what you're next charged, and your receipts."
    >
      <BillingPanel changed={changed} state={state} />
    </LPageShell>
  );
}
