import { redirect } from "next/navigation";
import NextLink from "next/link";
import { LPill, lButtonClass } from "@/components/ledger";
import { BRAND } from "@/lib/brand";
import { DASHBOARD_PATH } from "@/lib/nav";
import { getSessionContext } from "@/lib/supabase/account";
import { INTRO_FIRST_MONTH_LABEL } from "@/lib/stripe/server";
import {
  FEATURES,
  TIER_RANK,
  type FeatureId,
  type PlanTier,
} from "@/lib/entitlements";
import ProductShot, { type ShotSlug } from "./product-shot";
import {
  TIER_DISPLAY,
  TIER_ORDER,
  TIER_PRICE_COPY,
  isPubliclyClaimable,
} from "./pricing/pricing-model";

/**
 * THE PUBLIC FRONT DOOR. Read docs/MARKETING.md before changing a word
 * here: it carries the positioning, the message hierarchy and the claim
 * rules. The three that a well-meaning edit breaks most often:
 *
 *   TWO GENERATED, ONE ORGANISED. A trip GENERATES invoice lines and a
 *   logbook draft. Receipts are ORGANISED by it — the pilot creates the
 *   expense and tags it `rebill`, and createInvoiceDraft then picks the
 *   tagged ones up as reimbursable_expense lines. Section 2 row 03 says
 *   exactly that and no more. Never claim a trip creates an expense.
 *
 *   NOTHING BEYOND SHIPPED CODE. Every feature line below is tied to a
 *   FeatureId in lib/entitlements.ts, so its tier tag is derived rather
 *   than typed, and anything the public-claim filter removes (the
 *   counsel-gated currency board) or entitlements marks comingSoon (seats)
 *   disappears from this page mechanically. See specGroups() below.
 *
 *   THE TAGLINE IS NOT A HEADLINE. BRAND.tagline stays in the footer, the
 *   auth column and metadata.
 *
 * Figures are interpolated, never typed: the intro month is the SAME
 * constant the checkout passes to Stripe (lib/stripe/server.ts), and the
 * amounts come from ./pricing/pricing-model, the one marketing source for
 * docs/PRICING.md §3.2.
 *
 * ── THE VOICE, 2026-08-19 (owner's direction) ─────────────────────────
 *
 * The owner posted from the V1 account and told us to write the site the
 * same way. That post is quoted in full in docs/MARKETING.md §3.1 and it
 * is the register of record: plain declaratives, second person, ordinary
 * contractions, clauses joined with `and`/`so`/`then` rather than stacked
 * on commas, and a short line only where one is earned. No colon-lists.
 * No em dashes. No "streamline", no "purpose-built", no rule-of-three
 * pileups.
 *
 * TWO THINGS IN THAT POST DELIBERATELY DID NOT COME ACROSS. "No more
 * spreadsheets" is on the banned-phrase list this repo's marketing skill
 * keeps, and "gentlemen" addresses roughly half of this audience and
 * excludes the rest — a closing joke that works in one Facebook group is
 * not the front door of the business. Both are recorded in §3.1 so the
 * omission reads as a decision rather than an oversight.
 *
 * ── THE ANGLE, 2026-08-19 ─────────────────────────────────────────────
 *
 * The H1 is the mechanic again ("One trip entry drives the rest"), with
 * the category sentence and the money payoff carried by the subhead, in
 * the same order the owner's own post puts them. This supersedes the
 * 2026-08-17 arrangement where money led and the mechanic was demoted to
 * proof. The money beats did NOT leave: they are the payoff of section 2
 * and the whole of section 3. See docs/MARKETING.md §3.
 *
 * ── THE INFORMATION ARCHITECTURE, 2026-08-19 ──────────────────────────
 *
 * "How it works" used to be an ANCHOR on this page (/#how-it-works) in
 * the header and the footer, which is what a site does when it has one
 * page and four sections. It is now a real page, /how-it-works, and it
 * carries the long walkthrough this page only summarises. The trust
 * material that used to live entirely inside collapsed FAQ rows — export,
 * hold, cancel, what AMG can and cannot read — is a page too, /your-data.
 *
 * That gives this page one job again: say what V1 is, show the mechanic,
 * name the price, and hand a reader who wants depth a door to it. Both new
 * pages are in the header nav, the footer, sitemap.ts and robots.ts.
 */

/** A full-bleed band with the page's one shared measure inside it. */
function Band({
  children,
  tone = "canvas",
  id,
  measure = "default",
}: {
  children: React.ReactNode;
  /** `brand` is the navy ground, and it carries its own ink colour so a
   *  caller cannot half-apply it and leave dark text on dark. */
  tone?: "canvas" | "sunk" | "brand";
  id?: string;
  /**
   * `narrow` is the FAQ's reading column. `wide` is the hero's, and it is
   * a measurement rather than a preference: the hero carries a 1440px-wide
   * capture of the Overview screen, and its 7-of-12 track is what decides
   * how far that gets scaled down. At max-w-7xl the track is ~700px from
   * 1280px up — a hair under half scale, where the KPI figures are still
   * legible. That is why the hero's grid engages at `xl` and not at `lg`:
   * between 1024 and 1280 the stacked layout gives the shot the full
   * container, which is wider than the 7-of-12 track would be there.
   */
  measure?: "default" | "narrow" | "wide";
}) {
  const width =
    measure === "narrow"
      ? "max-w-3xl"
      : measure === "wide"
        ? "max-w-7xl"
        : "max-w-6xl";
  return (
    <section
      id={id}
      className={
        tone === "sunk"
          ? "bg-sunk"
          : tone === "brand"
            ? "bg-brand text-brand-ink"
            : undefined
      }
    >
      <div className={`mx-auto w-full ${width} px-5 py-14 sm:px-6 sm:py-20`}>
        {children}
      </div>
    </section>
  );
}

/**
 * WHAT THE ONE TRIP ENTRY DRIVES, in the order the work actually happens.
 *
 * Two generated, one organised (see the file header) governs rows 01–03.
 * Row 03's "you mark it rebill or keep" is the load-bearing half of the
 * sentence: the pilot creates the expense and sets the treatment, and
 * createInvoiceDraft (app/(app)/invoices/actions.ts, the
 * `reimbursable_expense` loop) then carries the rebill-tagged ones onto
 * the client's invoice. That is a real automatic step and it is claimable
 * BECAUSE the pilot's tag is what triggers it.
 *
 * Row 04 describes reports. It must never acquire a tax OUTCOME — see
 * docs/MARKETING.md claim rule 10. "Nothing gets rebuilt in January"
 * describes the software. "Saves you money at tax time" does not.
 *
 * TWO OF THE FOUR CARRY A SCREENSHOT, and only where the picture answers
 * the same thing the words do. Rows 03 and 04 have none: a receipt screen
 * beside copy about tagging receipts adds nothing, and four figures in one
 * band turns a ledger into a gallery.
 */
const DRIVES: { step: string; q: string; body: string; shot?: ShotSlug }[] = [
  {
    step: "01",
    q: "The invoice is already built.",
    body:
      "It priced itself off the rate card you set up for that client, so the flight days and the travel days are already on it at the right number. You read the lines and send it, and it goes out as a numbered PDF.",
    shot: "invoice",
  },
  {
    step: "02",
    q: "The logbook entries are already drafted.",
    // ONE DRAFT PER LEG, not one per trip: draftPayloadForLeg() in
    // app/(app)/logbook/db.ts is per-leg, the queue is titled "Trip drafts
    // — legs from completed trips", and one entry per flight is the only
    // form 14 CFR 61.51 recognises.
    body:
      "One draft per leg, with PIC and SIC kept apart. They sit in a queue and nothing reaches your logbook until you approve it.",
    shot: "logbook",
  },
  {
    step: "03",
    q: "The receipts are already on the trip.",
    // "you mark it rebill or keep" is the claim-rule-1 guard. Do not
    // rewrite this into the trip creating the expense.
    body:
      "Photograph a receipt at the FBO and mark it rebill or keep. Anything you marked rebill lands on that client's invoice as its own line, and the receipt pages can go out with the PDF.",
  },
  {
    step: "04",
    q: "Come tax season, nothing gets rebuilt.",
    // Describes reports. Never a tax outcome — claim rule 10.
    body:
      "That same trip is already in your profit and loss and your quarterly totals and the year-end packet your CPA asks for. You don't go back in January and reconstruct the year.",
  },
];

/**
 * THE SPEC BLOCK — grouped by the pilot's job.
 *
 * Each line declares the FeatureId(s) it describes, and that is what makes
 * the block honest without hand-maintenance:
 *
 *   - the tier tag is DERIVED from FEATURES[id].minTier, so a line can
 *     never read as included when the code gates it;
 *   - a line whose feature is not publicly claimable is dropped, so the
 *     counsel-gated currency board can never reappear here by edit;
 *   - a line whose feature entitlements marks comingSoon is dropped, which
 *     is why multi_seat appears nowhere on this page.
 *
 * The prose is written for the reader; the gating is read from the code.
 */
type SpecItem = { text: string; features: readonly FeatureId[] };
type SpecGroup = { title: string; items: readonly SpecItem[] };

const SPEC: readonly SpecGroup[] = [
  {
    title: "The flying",
    items: [
      { text: "Clients, aircraft, legs, and your own day types", features: ["trips"] },
      { text: "Client rate cards and W-9 status", features: ["clients"] },
      {
        text: "Logbook with PIC and SIC kept apart, plus CSV import and export",
        features: ["logbook"],
      },
      {
        text: "Medical, flight review, passport, and insurance dates",
        features: ["documents"],
      },
    ],
  },
  {
    title: "The money",
    items: [
      {
        // The Connect payment link is part of the invoices feature —
        // there is no separate FeatureId for it, and inventing one to
        // decorate this line would break the derivation this block runs
        // on. lib/stripe/connect.ts is the implementation.
        text: "Numbered invoice PDFs, email delivery, view tracking, and card or bank payment links through your own Stripe account",
        features: ["invoices"],
      },
      {
        // "the rate you set" is load-bearing. lib/mileage.ts stores that
        // year's rate in cents per mile AS THE PILOT ENTERED IT, and a
        // year with no rate on file renders miles with no dollar figure.
        // The product ships no rate table; dropping the qualifier turns an
        // input field into an advertised capability.
        text: "Receipt scanning and mileage records using the annual rate you set",
        features: ["expenses"],
      },
      {
        text: "Estimates, recurring invoices, and client statements",
        features: ["estimates", "recurring_invoices", "client_statements"],
      },
      { text: "CSV and OFX bank-statement imports", features: ["bank_import"] },
    ],
  },
  {
    title: "The year",
    items: [
      {
        text: "Profit and loss, quarterly summaries, and a CPA-ready year-end packet",
        features: ["reports_core"],
      },
      {
        // account_export is minTier "solo" DELIBERATELY — read the comment
        // on that row in lib/entitlements.ts. Its tag is derived, so this
        // line cannot drift back into overstating the tier.
        text: "Account-wide CSV export on every plan",
        features: ["account_export"],
      },
      { text: "Sales tax report", features: ["sales_tax_report"] },
      {
        text: "Double-entry books with reconciliation",
        features: ["accounting"],
      },
    ],
  },
];

/** The highest tier any of a line's features needs, or null for Solo. */
function tagFor(features: readonly FeatureId[]): PlanTier | null {
  let top: PlanTier = "solo";
  for (const id of features) {
    const min = FEATURES[id].minTier;
    if (TIER_RANK[min] > TIER_RANK[top]) top = min;
  }
  return top === "solo" ? null : top;
}

/** The spec block as rendered: unclaimable and unshipped lines removed. */
function specGroups(): {
  title: string;
  items: { text: string; tag: string | null }[];
}[] {
  return SPEC.map((group) => ({
    title: group.title,
    items: group.items
      .filter((item) =>
        item.features.every(
          (id) => isPubliclyClaimable(id) && !FEATURES[id].comingSoon
        )
      )
      .map((item) => {
        const tier = tagFor(item.features);
        return { text: item.text, tag: tier ? TIER_DISPLAY[tier].name : null };
      }),
  }));
}

/**
 * FOUR QUESTIONS. Only the ones that remove a real barrier before a card
 * is entered. The second is non-negotiable: it carries the substance of
 * lib/brand.ts's counsel-reviewed CURRENCY_DISCLAIMER — this product never
 * presents itself as deciding whether a pilot is legal to fly.
 *
 * The third is the hold, which the owner's post raised and this site had
 * never mentioned outside a /pricing accordion. Its wording tracks
 * app/(app)/settings/account-actions.ts and docs/PRICING.md §5: two months,
 * read-only while it runs, resumes on the date you set, and the airman
 * records are kept whatever happens. The clearing caveat stays in — a hold
 * that quietly deletes the business side would be the single worst thing
 * this page could fail to mention.
 */
const FAQ: { q: string; a: string }[] = [
  {
    q: "I already keep a logbook. Do I have to start over?",
    a: "No. Bring in a ForeFlight or LogTen Pro export, or any CSV through the column mapper, and carry on from where you left off.",
  },
  {
    q: "Does it decide whether I'm current or legal to fly?",
    a: "No, and it will never present itself that way. It tracks the dates you entered off your own documents so you can see what's coming due. Currency and airworthiness decisions stay yours.",
  },
  {
    q: "What if I'm not flying for a while?",
    a: "Put the account on hold and set the date it comes back. Billing pauses for up to two months and it resumes on that date by itself, and your records go read-only in the meantime with nothing deleted. If a hold runs the full two months and isn't resumed, the business side is cleared, but your logbook, your documents, your aircraft and your operator qualifications are kept whatever happens.",
  },
  {
    q: "What happens to my records if I cancel?",
    a: "Nothing is deleted. The account goes read-only and the export keeps working. A pilot's logbook is a legal record, and a lapsed card will never be the thing that destroys one.",
  },
];

/**
 * "/" lives here rather than in app/(app) because that route group is
 * wrapped, unconditionally, by requireAccount(). A signed-in visitor is
 * bounced before any marketing copy renders: provisioned account -> the
 * dashboard, signed in with no account yet -> /welcome.
 */
export default async function LandingPage() {
  const ctx = await getSessionContext();
  if (ctx?.account) redirect(DASHBOARD_PATH);
  if (ctx) redirect("/welcome");

  const groups = specGroups();

  return (
    <>
      {/* ── 1. HERO ──────────────────────────────────────────────────────
          Navy, and asymmetric: the argument holds a 5-of-12 column and the
          product holds 7, rather than the headline sitting centered above a
          full-width screenshot. Stacks at lg and below. */}
      <Band tone="brand" measure="wide">
        <div className="grid grid-cols-1 items-center gap-10 xl:grid-cols-12 xl:gap-8">
          <div className="flex flex-col items-start gap-5 xl:col-span-5">
            {/* Not an LPill: that primitive's whitespace-nowrap is right for
                a status badge ("Paid") and wrong for a phrase, which on a
                narrow phone just runs off the edge. */}
            <p className="font-mono text-caption font-medium tracking-widest text-brand-accent uppercase">
              For independent contract pilots
            </p>

            {/* THE page's only h1, and the only thing on the page set in
                --text-display. */}
            <h1 className="font-display text-display font-bold text-brand-ink">
              One trip entry drives the rest.
            </h1>

            <p className="text-lead text-brand-ink-2">
              {BRAND.name} is a business management platform we built for
              pilots. You log the trip once and the invoice, the logbook
              drafts and the year-end numbers all come off that one record.
            </p>

            <div className="mt-1 flex flex-wrap gap-3">
              <NextLink
                href="/signup"
                className={lButtonClass({ size: "lg", variant: "onBrand" })}
              >
                Try {BRAND.name} — {INTRO_FIRST_MONTH_LABEL} first month
              </NextLink>
              <NextLink
                href="/how-it-works"
                className={lButtonClass({
                  size: "lg",
                  variant: "onBrandOutline",
                })}
              >
                See how it works
              </NextLink>
            </div>

            <p className="text-caption text-brand-ink-2">
              Plans start at {TIER_PRICE_COPY.solo.monthly}/month, and the
              first month is {INTRO_FIRST_MONTH_LABEL} on any of them. Card
              required.
            </p>
          </div>

          {/* THE PRODUCT VISUAL — a real capture of the real Overview
              screen, with invented data (see ./product-shot.tsx, and the
              harness it names). Floated on the navy rather than boxed into
              the text column: shadow-float exists because shadow-card's 4%
              is invisible against a dark field. Eager, not lazy — it is the
              fold. */}
          <div className="xl:col-span-7">
            <ProductShot slug="overview" onBrand priority />
          </div>
        </div>
      </Band>

      {/* ── 2. WHAT THE ONE ENTRY DRIVES ─────────────────────────────────
          The mechanic, in four rows, ending on the year. The long-form
          version of this is /how-it-works; this band exists to earn the
          click rather than to replace it. */}
      <Band>
        <div className="flex flex-col gap-8">
          <div className="flex max-w-2xl flex-col gap-4">
            <h2 className="font-display text-display-s font-bold text-ink">
              You log the trip once
            </h2>
            <div className="flex items-start gap-3 border-l-2 border-accent pl-4">
              <p className="text-body text-ink-2">
                Put in the client, the tail number, the legs you flew and how
                each day counted, whether that was a flight day or a travel
                day or standby. That's the only time you type any of it.
              </p>
            </div>
          </div>

          {/* Hairline-separated rows, not cards: a ledger of claim and
              detail, which is the shape the product itself uses for money.
              Four bordered boxes side by side is the template shape this
              page deliberately does not have. */}
          <div className="divide-y divide-hair border-t border-hair">
            {DRIVES.map((row) => (
              <div
                key={row.q}
                className="grid grid-cols-1 gap-x-8 gap-y-3 py-6 md:grid-cols-12 md:items-baseline"
              >
                <div className="flex items-baseline gap-3 md:col-span-4">
                  <span className="font-mono tnum-l text-body-s font-semibold text-accent">
                    {row.step}
                  </span>
                  <h3 className="font-display text-h3 font-semibold text-ink">
                    {row.q}
                  </h3>
                </div>
                <div className="flex flex-col gap-5 md:col-span-8">
                  <p className="text-body text-ink">{row.body}</p>
                  {/* max-w-2xl, not the full 8-of-12 track: the figure is
                      the claim's evidence, so it sits inside the claim
                      rather than taking the row. */}
                  {row.shot ? (
                    <ProductShot slug={row.shot} className="max-w-2xl" />
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div>
            <NextLink href="/how-it-works" className={lButtonClass({ variant: "outline" })}>
              Walk through a whole trip
            </NextLink>
          </div>
        </div>
      </Band>

      {/* ── 3. GETTING PAID ──────────────────────────────────────────────
          NEW at the 2026-08-19 rewrite, and overdue: Stripe Connect has
          been shipped since lib/stripe/connect.ts and the public site had
          never once mentioned that a client can pay an invoice. Chasing
          payment is the pain this audience actually names.

          EVERY SENTENCE HERE IS LOAD-BEARING AND CHECKED:
            - Standard Connect, DIRECT charges, no application fee — the
              money settles in the pilot's own Stripe account and never
              touches AMG's (lib/stripe/connect.ts's verified-against-docs
              header).
            - We hold the acct_… id and never a key of theirs. Same header.
            - Auto-recording on settlement, and the ACH middle state, are
              lib/stripe/connect-payments.ts's whole subject.
            - The refund limitation is that file's "WHAT THIS MODULE
              DELIBERATELY DOES NOT DO" paragraph, stated here rather than
              left for a pilot to discover. Do not delete it to tidy the
              band; it is the most credible sentence on the page. */}
      <Band tone="sunk">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-5">
            <h2 className="font-display text-display-s font-bold text-ink">
              Getting paid runs through your own Stripe account
            </h2>
          </div>
          <div className="flex flex-col gap-4 lg:col-span-7">
            <p className="text-body text-ink">
              Connect your Stripe account and every invoice can go out with a
              payment link on it, so the client pays by card or bank debit
              from the invoice itself. The money settles into your account
              rather than ours, and we never hold a key to it.
            </p>
            <p className="text-body text-ink">
              When a payment clears, it records itself against that invoice
              and the balance moves without you typing it in. A bank debit
              takes a few days to settle, so {BRAND.name} tells you it's in
              flight instead of going quiet on you for a week.
            </p>
            <p className="text-body-s text-ink-2">
              What it won't do is move money back out. Refunds and disputes
              you handle in Stripe, then correct the payment here yourself.
              Reversing money automatically is a bigger claim than recording
              it and we're not making it.
            </p>
          </div>
        </div>
      </Band>

      {/* ── 4. THE SPEC BLOCK ────────────────────────────────────────────
          Asymmetric and sticky: the heading holds a 4-of-12 column and stays
          put on a tall screen while the list moves, so the reader always
          knows what the list is answering. Every Pro/Business tag is derived
          from lib/entitlements.ts — see specGroups(). */}
      <Band>
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-4">
            <div className="lg:sticky lg:top-24">
              <h2 className="font-display text-display-s font-bold text-ink">
                What else is in there
              </h2>
              <NextLink
                href="/pricing"
                className={lButtonClass({
                  variant: "outline",
                  className: "mt-5",
                })}
              >
                Compare all features
              </NextLink>
            </div>
          </div>

          <div className="flex flex-col gap-8 lg:col-span-8">
            {groups.map((group) => (
              <div key={group.title} className="flex flex-col gap-3">
                <p className="font-mono text-caption font-medium uppercase tracking-widest text-accent">
                  {group.title}
                </p>
                <ul className="divide-y divide-hair border-t border-hair">
                  {group.items.map((item) => (
                    <li
                      key={item.text}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
                    >
                      <span className="text-body text-ink">{item.text}</span>
                      {/* The tier tag is a pill, not grey suffix text: a
                          reader scanning for what their plan includes has to
                          find it without reading the line. Its VALUE is
                          derived, so it cannot claim the wrong tier. */}
                      {item.tag ? <LPill tone="accent">{item.tag}</LPill> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </Band>

      {/* ── 5. BEFORE YOU SIGN UP ────────────────────────────────────────
          Native <details>/<summary> — works with no JavaScript, and is
          keyboard- and screen-reader-correct for free. The two data answers
          are summaries; /your-data is where they are answered properly. */}
      <Band tone="sunk" measure="narrow">
        <div className="flex flex-col gap-5">
          <h2 className="font-display text-display-s font-bold text-ink">
            Questions pilots ask us
          </h2>
          <div className="border-t border-hair">
            {FAQ.map((item) => (
              <details key={item.q} className="group border-b border-hair">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="text-body font-medium text-ink">
                    {item.q}
                  </span>
                  {/* Rotates to an X on open. `transition-transform` with
                      motion-reduce cancelling it, per the same rule the
                      button press-scale follows. */}
                  <span
                    aria-hidden
                    className="shrink-0 text-h3 leading-none text-ink-3 transition-transform duration-150 group-open:rotate-45 motion-reduce:transition-none"
                  >
                    +
                  </span>
                </summary>
                <p className="pb-4 pr-8 text-body-s text-ink-2">{item.a}</p>
              </details>
            ))}
          </div>
          <p className="text-body-s text-ink-2">
            The longer answers on holds, cancelling and what we can and
            can't read are on{" "}
            <NextLink href="/your-data" className="font-medium text-accent underline underline-offset-2">
              your data
            </NextLink>
            .
          </p>
        </div>
      </Band>

      {/* ── 6. CLOSE ─────────────────────────────────────────────────────
          Navy again, bookending the hero. The price is stated once on this
          page, in the hero; what this adds is the export promise, which is
          the strongest trust claim the product has and is true on every
          tier (docs/MARKETING.md claim rule 6). */}
      <Band tone="brand">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div className="flex max-w-xl flex-col gap-3">
            <h2 className="font-display text-display-s font-bold text-brand-ink">
              Start with your next trip.
            </h2>
            <p className="text-body text-brand-ink-2">
              {TIER_ORDER.map((tier) => TIER_DISPLAY[tier].name).join(", ")}{" "}
              plans, every one of them {INTRO_FIRST_MONTH_LABEL} for the first
              month, and a full account export on all three.
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
