import NextLink from "next/link";
import { lButtonClass } from "@/components/ledger";
import { BRAND } from "@/lib/brand";
import { INTRO_FIRST_MONTH_LABEL } from "@/lib/stripe/server";
import { TIER_PRICE_COPY } from "../pricing/pricing-model";

/**
 * /your-data — the trust page, new at the 2026-08-19 restructure.
 *
 * WHY IT IS A PAGE. Every commitment on it was already true and already
 * written down, and every one of them was reachable only by opening a
 * collapsed accordion row on the landing page or two thirds of the way
 * down /pricing. Export on every plan is the strongest claim this product
 * has (docs/MARKETING.md claim rule 6, and lib/entitlements.ts's own
 * "gating export is the one upsell this product refuses"), and it was
 * hidden behind a summary element. A sceptical pilot who has been burned
 * by an app that lost their data goes looking for exactly this, and until
 * now there was nowhere to send them.
 *
 * IT MAKES NO NEW CLAIM. Every paragraph below restates something already
 * committed to in docs/PRICING.md §5, lib/entitlements.ts, or the hold
 * implementation in app/(app)/settings/account-actions.ts and
 * lib/stripe/hold.ts. If a sentence here cannot be traced to one of those,
 * it does not belong on the page.
 *
 * THE FOUR SECTIONS ARE IN ESCALATING ORDER OF THE READER'S FEAR: getting
 * it out, stopping for a while, cancelling, and who can read it. Do not
 * reorder them into feature order.
 *
 * THE HOLD SECTION KEEPS ITS CAVEAT. A hold that runs the full two months
 * without being resumed clears the business side of the account. That is
 * the one genuinely bad surprise in this product and it is stated in the
 * same breath as the feature, not in a footnote. Deleting it to make the
 * page read better would be the exact failure this page exists to prevent.
 */

export const metadata = {
  title: "Your data",
  description:
    `Every plan gets a full account export, nothing is deleted when you ` +
    `cancel, and your logbook and airman documents are kept whatever ` +
    `happens to your ${BRAND.name} subscription.`,
};

function Band({
  children,
  tone = "canvas",
}: {
  children: React.ReactNode;
  tone?: "canvas" | "sunk" | "brand";
}) {
  return (
    <section
      className={
        tone === "sunk"
          ? "bg-sunk"
          : tone === "brand"
            ? "bg-brand text-brand-ink"
            : undefined
      }
    >
      <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-6 sm:py-20">
        {children}
      </div>
    </section>
  );
}

/**
 * SECTIONS. Each `title` is a plain statement rather than a noun label,
 * because a reader scanning this page is checking claims, not browsing
 * topics.
 */
const SECTIONS: { title: string; paras: string[] }[] = [
  {
    title: "You can take all of it out, on any plan",
    paras: [
      "The account-wide export is in Settings on every plan including the cheapest one. We don't gate it and we're not going to. It writes one CSV per record type, so you get a file each for your clients and your trips and your trip days and legs, and the same again for your estimates, invoices, payments, expenses, mileage and documents.",
      "Your logbook exports in full on its own, every report downloads, and the receipt and document files you uploaded download from their own pages. If you want to leave, you leave with everything you put in.",
    ],
  },
  {
    title: "You can stop for a while without losing anything",
    paras: [
      "Not flying for a bit? Put the account on hold and set the date you want it back. Billing pauses for up to two months and it resumes on that date by itself, so there's nothing to remember. Your records go read-only while the hold runs and nothing is deleted, and you can end it early whenever you want.",
      "Here's the part we'd rather tell you now than have you find out later. If a hold runs the full two months and isn't resumed or paid for, the business side of the account is cleared, meaning your clients, trips, invoices, estimates, expenses and the accounting ledger. We tell you before that happens and the export works the whole time.",
      "Your logbook, your documents, your aircraft and your operator qualifications are kept whatever happens. Those are your records as an airman and they're not ours to delete over a subscription.",
    ],
  },
  {
    title: "Cancelling doesn't delete anything",
    paras: [
      "Cancel and the account goes read-only. Everything stays there and stays viewable, and the export keeps working. Downgrading is the same idea in miniature: the screens your new plan doesn't include close, they come straight back if you upgrade again, and every record you already made stays in the export the whole time.",
      "A pilot's logbook is a legal record. A lapsed card will never be the thing that destroys one.",
    ],
  },
  {
    title: "What we can and can't see",
    paras: [
      "When you take payments, you connect your own Stripe account and the money settles there rather than with us. We hold the account identifier that says which Stripe account is yours, and never a key belonging to it, so we can't move your money and we can't take a cut of it.",
      "On the records themselves, every account is walled off from every other one in the database itself rather than only in the screens. Support can't browse your client list to answer a ticket.",
    ],
  },
];

export default function YourDataPage() {
  return (
    <>
      <Band tone="brand">
        <div className="flex flex-col items-start gap-5">
          <p className="font-mono text-caption font-medium uppercase tracking-widest text-brand-accent">
            Your data
          </p>
          <h1 className="font-display text-display font-bold text-brand-ink">
            It's yours, and you can take it with you
          </h1>
          <p className="text-lead text-brand-ink-2">
            You're putting your logbook and your client list and your year's
            money into something new, from a company you hadn't heard of last
            week. Here's exactly what happens to all of it, including the one
            case where something does get cleared.
          </p>
        </div>
      </Band>

      <Band>
        <div className="flex flex-col gap-10">
          {SECTIONS.map((section) => (
            <div key={section.title} className="flex flex-col gap-3">
              <h2 className="font-display text-h2 font-bold text-ink">
                {section.title}
              </h2>
              {section.paras.map((para) => (
                <p key={para.slice(0, 40)} className="text-body text-ink">
                  {para}
                </p>
              ))}
            </div>
          ))}
        </div>
      </Band>

      <Band tone="sunk">
        <div className="flex flex-col items-start gap-4">
          <h2 className="font-display text-h2 font-bold text-ink">
            One thing this doesn't do
          </h2>
          <p className="text-body text-ink">
            It tracks the dates you entered off your own documents and shows
            you what's coming due. It does not decide whether you're current
            or legal to fly, and it will never present itself that way.
            Currency and airworthiness decisions stay yours, the same as they
            were before you had software for any of this.
          </p>
        </div>
      </Band>

      <Band tone="brand">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div className="flex max-w-lg flex-col gap-3">
            <h2 className="font-display text-display-s font-bold text-brand-ink">
              Start with your next trip.
            </h2>
            <p className="text-body text-brand-ink-2">
              Plans start at {TIER_PRICE_COPY.solo.monthly} a month and the
              first month is {INTRO_FIRST_MONTH_LABEL} on any of them.
            </p>
          </div>
          <NextLink
            href="/signup"
            className={lButtonClass({
              size: "lg",
              variant: "onBrand",
              className: "shrink-0",
            })}
          >
            Try {BRAND.name} — {INTRO_FIRST_MONTH_LABEL} first month
          </NextLink>
        </div>
      </Band>
    </>
  );
}
