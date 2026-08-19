import NextLink from "next/link";
import { lButtonClass } from "@/components/ledger";
import { BRAND } from "@/lib/brand";
import { INTRO_FIRST_MONTH_LABEL } from "@/lib/stripe/server";
import ProductShot, { type ShotSlug } from "../product-shot";
import Reveal from "../reveal";
import { TIER_PRICE_COPY } from "../pricing/pricing-model";

/**
 * /how-it-works — THE WALKTHROUGH, and a real page as of 2026-08-19.
 *
 * It used to be an anchor (`/#how-it-works`) into the landing page's
 * mechanic band, which is what a site does when it has one page and four
 * sections. The landing page now summarises the mechanic in four rows and
 * hands the reader here for the whole of it, so the front door can go back
 * to doing one job.
 *
 * THE SHAPE IS ONE TRIP, START TO FINISH, because that is the shape the
 * owner's own Facebook post used and the shape a pilot can check against
 * their own week. A feature inventory was tried first and read as a list of
 * things rather than an account of work; docs/MARKETING.md §3.1 records
 * why the walkthrough replaced it.
 *
 * EVERY CLAIM RULE IN docs/MARKETING.md §5 BINDS THIS PAGE exactly as hard
 * as it binds the landing page. The three most easily broken here:
 *
 *   TWO GENERATED, ONE ORGANISED (rule 1). Step 3 is the one that goes
 *   wrong. The pilot creates the expense and tags it `rebill`; the invoice
 *   draft then carries the tagged ones as reimbursable_expense lines. A
 *   trip never creates an expense. Do not compress that into "receipts
 *   bill themselves".
 *
 *   NO LEGALITY (rule 4). Step 6 names the dates the product tracks and
 *   says outright that the decision is the pilot's. The substance of
 *   lib/brand.ts's counsel-reviewed CURRENCY_DISCLAIMER lives there.
 *
 *   NO TAX OUTCOME (rule 10). Step 5 describes reports and totals. "Lands
 *   in the year's deductible total" describes the software and is allowed.
 *   "Is deductible" and "saves you $X" are not.
 *
 * The day-type names in step 1 are the three the product seeds for a new
 * account (Flight day, Travel day, Standby day — see
 * supabase/migrations/20260807000000_phase9_day_types_and_trip_days.sql)
 * plus the pilot's own additions, which is why the sentence says the
 * taxonomy is theirs rather than naming a closed set.
 */

export const metadata = {
  title: "How it works",
  description:
    `One trip entry drives the rest of ${BRAND.name}. Walk a single trip ` +
    `from the day you log it through the invoice and the per-leg logbook ` +
    `drafts and the receipts, all the way to the year-end packet.`,
};

/** A full-bleed band with the page's shared measure inside it. */
function Band({
  children,
  tone = "canvas",
  glow = "top",
  measure = "default",
}: {
  children: React.ReactNode;
  /** Dark-surface semantics since the 2026-08-19 reskin: `sunk` is a
   *  hairline seam, `brand` a glow section — see the landing page's Band. */
  tone?: "canvas" | "sunk" | "brand";
  glow?: "top" | "low";
  measure?: "default" | "narrow";
}) {
  return (
    <section
      className={
        tone === "sunk"
          ? "border-t border-hair"
          : tone === "brand"
            ? "relative overflow-hidden"
            : undefined
      }
    >
      {tone === "brand" ? (
        <div aria-hidden className={glow === "low" ? "mkt-glow-low" : "mkt-glow"} />
      ) : null}
      <div
        className={`mx-auto w-full ${
          measure === "narrow" ? "max-w-3xl" : "max-w-5xl"
        } relative px-5 py-16 sm:px-6 sm:py-24`}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * THE SIX STEPS. `note` is the honest caveat on a step, and it renders in
 * quieter ink beneath the body. Three of the six carry one, on purpose:
 * a walkthrough with no limits in it is a demo, not an explanation.
 */
const STEPS: {
  step: string;
  title: string;
  body: string;
  note?: string;
  shot?: ShotSlug;
}[] = [
  {
    step: "01",
    title: "You log the trip",
    body:
      "Say you fly Tuesday to Thursday for one of your clients and travel out on the Monday to get there. You put in the client, the tail number, the legs you flew and how each of those four days counted. Day types are your own list, so if you bill a standby day or a cancellation differently from everyone else, you set that up once and it stays that way.",
    note: "This is the only time you type any of it. Everything below reads off this one record.",
  },
  {
    step: "02",
    title: "The invoice is already built",
    body:
      "It priced itself off the rate card you set up for that client, so your flight days and your travel day are already on it at the numbers the two of you agreed. Per diem and a cancellation fee go on the same invoice when the trip earned them. You read the lines, change what needs changing, and send it as a numbered PDF.",
    shot: "invoice",
  },
  {
    step: "03",
    title: "The receipts go on it too",
    body:
      "Photograph a receipt at the FBO and mark it rebill or keep. Rebill puts it on that client's invoice as its own line the next time you draft one, and the receipt pages can go out attached to the PDF so nobody has to email you asking for them. Keep leaves it in your own expense records instead.",
    note:
      "You decide which one it is. Nothing here invents an expense off a trip, and a receipt already billed on one invoice can't be billed again on another.",
  },
  {
    step: "04",
    title: "The logbook entries are already drafted",
    body:
      "One draft per leg, with PIC and SIC time kept apart, waiting in a queue. You look them over and approve them and they go in. Bring your history with you from a ForeFlight or LogTen Pro export, or any CSV through the column mapper.",
    note: "Nothing reaches your logbook without you approving it first.",
    shot: "logbook",
  },
  {
    step: "05",
    title: "The client pays from the invoice",
    body:
      "Connect your own Stripe account and the invoice goes out with a card or bank payment link on it. The money settles into your account rather than ours. When it clears, the payment records itself against that invoice and the balance moves on its own, and a bank debit that's still in flight says so rather than going quiet for a week.",
    note:
      "Money going back out stays manual. Refunds and disputes you handle in Stripe, then correct the payment here yourself.",
  },
  {
    step: "06",
    title: "The year is already written",
    body:
      "That Tuesday-to-Thursday trip is already a line in your profit and loss, in your quarterly totals and in the year-end packet your CPA asks for. Your clients and their rate cards, your aircraft, and the dates you keep an eye on all sit in the same account, so your medical and your flight review stop living on a sticky note.",
    note:
      "It tracks the dates you entered off your own documents and shows you what's coming due. It does not decide whether you're current or legal to fly, and it never will. That call is yours.",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      {/* HERO. No product shot: the shots belong beside the steps that
          earn them, and a seventh figure at the top would just delay the
          thing the reader came for. */}
      <Band tone="brand">
        <Reveal className="flex max-w-2xl flex-col items-start gap-5">
          <p className="font-mono text-caption font-medium uppercase tracking-widest text-accent">
            How it works
          </p>
          <h1 className="mkt-display font-display font-bold text-ink">
            One trip, start to finish
          </h1>
          <p className="text-lead text-ink-2">
            {BRAND.name} is a business management platform we built for
            pilots, and the easiest way to explain it is to walk one trip
            through it. Here's the whole of it, from the day you log it to
            the packet your CPA asks for in January.
          </p>
        </Reveal>
      </Band>

      {/* THE SIX STEPS. Hairline rows on the shared ledger shape the rest
          of the site uses, not six cards. */}
      <Band>
        <div className="divide-y divide-hair border-t border-hair">
          {STEPS.map((row) => (
            <div
              key={row.step}
              className="grid grid-cols-1 gap-x-8 gap-y-3 py-8 md:grid-cols-12"
            >
              <div className="flex items-baseline gap-3 md:col-span-4">
                <span className="font-mono tnum-l text-body-s font-semibold text-accent">
                  {row.step}
                </span>
                <h2 className="font-display text-h3 font-semibold text-ink">
                  {row.title}
                </h2>
              </div>
              <div className="flex flex-col gap-4 md:col-span-8">
                <p className="text-body text-ink">{row.body}</p>
                {row.note ? (
                  <p className="border-l-2 border-accent pl-4 text-body-s text-ink-2">
                    {row.note}
                  </p>
                ) : null}
                {row.shot ? (
                  <ProductShot slug={row.shot} className="max-w-2xl" />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Band>

      {/* WHY IT IS SHAPED THIS WAY. The one section on the public site
          that takes a position rather than describing a screen. It is the
          multi-client inversion, and it is claim-rule-7 safe because it
          names no competitor and calls no other tool bad at its own job:
          the cost being described is the seam between three tools that do
          not know about each other. */}
      <Band measure="narrow">
        <Reveal className="mkt-panel flex flex-col gap-4 px-6 py-8 sm:px-9 sm:py-10">
          <h2 className="mkt-display-s font-display font-bold text-ink">
            Why it assumes you fly for more than one outfit
          </h2>
          <p className="text-body text-ink">
            Every client you fly for runs a system built to look at their own
            crew, and that's the right thing for them to have. What none of
            them can do is look at your whole year across all of them, so
            that ends up being your job, in a logbook app and a spreadsheet
            and whatever you use for books.
          </p>
          <p className="text-body text-ink">
            You're the integration between those three, and you do it by
            typing the same trip in over and over. {BRAND.name} takes the
            other side of that. One record per trip, your clients and their
            rate cards in one place, and one set of totals at the end of the
            year that actually covers everybody you flew for.
          </p>
        </Reveal>
      </Band>

      {/* CLOSE. One action, and the price stated once on this page. */}
      <Band tone="brand" glow="low">
        <Reveal className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div className="flex max-w-xl flex-col gap-3">
            <h2 className="mkt-display-s font-display font-bold text-ink">
              Start with your next trip.
            </h2>
            <p className="text-body text-ink-2">
              Plans start at {TIER_PRICE_COPY.solo.monthly} a month and the
              first month is {INTRO_FIRST_MONTH_LABEL} on any of them.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <NextLink
              href="/signup"
              className={lButtonClass({
                size: "lg",
                variant: "onBrand",
                className: "group rounded-full pr-2",
              })}
            >
              Try {BRAND.name} — {INTRO_FIRST_MONTH_LABEL} first month
              <span aria-hidden className="mkt-orb mkt-orb-onlight">
                ↗
              </span>
            </NextLink>
            <NextLink
              href="/pricing"
              className={lButtonClass({
                size: "lg",
                variant: "onBrandOutline",
                className: "rounded-full",
              })}
            >
              View plans
            </NextLink>
          </div>
        </Reveal>
      </Band>
    </>
  );
}
