import { LAlert } from "@/components/ledger";
import { BRAND } from "@/lib/brand";

/**
 * noindex for the same reason as app/(marketing)/terms/page.tsx: this page
 * says in its own body that there is no published policy yet, and a
 * placeholder saying so should not be the search result for this product's
 * name. The URL stays stable and the footer links it. Remove the override when
 * counsel's text lands (docs/LAUNCH-GATES.md G3).
 */
export const metadata = {
  title: "Privacy Policy",
  robots: { index: false, follow: true },
};

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v3.5" />
      <circle cx="8" cy="5.25" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * COUNSEL-GATED PLACEHOLDER — docs/LAUNCH-GATES.md G3. Same reasoning as
 * app/(marketing)/terms/page.tsx: this route holds the URL, not a policy.
 *
 * The bullet list below states only facts already true of the built
 * system (subprocessors, where receipts are stored, where OCR runs) —
 * every one of them is verifiable in this repo, not a promise this page is
 * making on its own authority. It deliberately stops short of any custody
 * claim: docs/PLAN.md §0's correction, which docs/LAUNCH-GATES.md G3
 * restates, is that no RLS policy and no application code path grants one
 * tenant anything about another, but the service-role key, the owning
 * Postgres role, and Supabase dashboard access all read every tenant's
 * data — an operational fact, not a database guarantee. The house rule is
 * "no application code path", never "we cannot technically see your
 * data," and this page follows it by not making the broader claim at all.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:py-16">
      <div className="flex flex-col gap-5">
        <h1 className="text-h1 font-bold text-ink">Privacy Policy</h1>

        <LAlert tone="warn" className="flex items-start gap-2">
          <InfoIcon className="mt-0.5 shrink-0 text-warn" />
          <span>
            <span className="font-medium text-ink">
              Placeholder, pending review by aviation counsel.
            </span>{" "}
            Nothing on this page is a binding privacy commitment. {BRAND.name}{" "}
            has not yet published a Privacy Policy, and no version of this
            text has been reviewed or approved.
          </span>
        </LAlert>

        <div className="flex flex-col gap-2">
          <p className="text-body-s text-ink-2">
            A few facts about how the product handles data today, ahead
            of the policy that will formally cover them:
          </p>
          <p className="text-body-s text-ink-2">
            · Data processors: Supabase (database, file storage, and
            sign-in), Vercel (hosting), Stripe (billing and client
            payment links), and Resend (account email).
          </p>
          <p className="text-body-s text-ink-2">
            · Receipts you upload are stored in a private file bucket,
            scoped to your account.
          </p>
          <p className="text-body-s text-ink-2">
            · Receipt scanning runs in your own browser, not on a server:
            a receipt image is never uploaded just to be read.
          </p>
          <p className="text-body-s text-ink-2">
            · Bank statement files are read and parsed in your own
            browser too. The transactions reach us when you confirm the
            import; the statement file itself is never uploaded, only
            its name and row count.
          </p>
        </div>

        <p className="text-body-s text-ink-2">
          This is not the complete policy. It does not yet address data
          retention, deletion, or every detail a full policy has to
          cover. That text is pending counsel review.
        </p>
      </div>
    </div>
  );
}
