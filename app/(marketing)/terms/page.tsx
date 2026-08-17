import { LAlert } from "@/components/ledger";
import { BRAND } from "@/lib/brand";

/**
 * noindex, overriding the marketing layout's `index: true`. This page says in
 * its own body that there are no Terms yet, and a placeholder saying so is the
 * last thing that should be a search result for this product's name. The URL
 * stays stable and reachable — the footer links it, and anyone who asks can
 * read exactly where things stand — it simply is not offered to crawlers until
 * there is a document here worth finding. Remove the override when counsel's
 * text lands (docs/LAUNCH-GATES.md G3).
 */
export const metadata = {
  title: "Terms of Service",
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
 * COUNSEL-GATED PLACEHOLDER — docs/LAUNCH-GATES.md G3.
 *
 * This route exists so the URL is stable and discoverable before launch,
 * NOT because there is a Terms of Service to publish. G3 is explicit that
 * an agent may "prepare, draft, and say 'this is ready for review'" but
 * must "never soften a disclaimer, never publish a claim" — writing
 * plausible-sounding terms language here would be exactly the thing that
 * gate exists to prevent, so this page states its own status instead of
 * simulating a document aviation counsel has not yet drafted or approved.
 *
 * Two things G3 already establishes as true today, so this page does not
 * imply otherwise by omission: signup captures no acceptance of anything
 * (app/(auth)/signup/signup-form.tsx has no checkbox, and recording
 * acceptance needs a migration that does not exist yet), and there is no
 * self-serve cancellation path — "cancel anytime" is not a claim this
 * page makes.
 */
export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:py-16">
      <div className="flex flex-col gap-5">
        <h1 className="text-h1 font-bold text-ink">Terms of Service</h1>

        <LAlert tone="warn" className="flex items-start gap-2">
          <InfoIcon className="mt-0.5 shrink-0 text-warn" />
          <span>
            <span className="font-medium text-ink">
              Placeholder, pending review by aviation counsel.
            </span>{" "}
            Nothing on this page is a binding agreement. {BRAND.name} has
            not yet published Terms of Service, and no version of this
            text has been reviewed or approved by counsel or by the
            product owner.
          </span>
        </LAlert>

        <p className="text-body-s text-ink-2">
          When this page is published for real, it will cover the terms
          of using {BRAND.name} (including billing, the introductory
          first-month price, and
          cancellation), and creating an account will ask you to accept
          it explicitly. Until then, this URL exists so it has a stable
          address; it does not yet describe any agreement you are bound
          by.
        </p>
      </div>
    </div>
  );
}
