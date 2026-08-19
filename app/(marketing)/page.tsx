import type { Metadata } from "next";
import { cookies } from "next/headers";
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
import Reveal from "./reveal";
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
 * ── DESIGN, 2026-08-17 (unchanged by the rewrite below) ───────────────
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
 * ── THE REWRITE, 2026-08-18 ───────────────────────────────────────────
 *
 * Implemented from docs/reviews/10-landing-page-copy.md, which is the
 * spec of record for every string below and carries the reasoning, the
 * critic resolutions and the grounding for each claim. The position did
 * not change: the H1, the eyebrow and the subhead are the owner-signed
 * money position, kept verbatim. What changed is everything the site
 * audit found MISSING around them:
 *
 *   - THE CTA STOPPED PROMISING A TRIAL. "Try V1" promised an immediate,
 *     low-stakes look at the product; the next screens are an identity
 *     form, a mandatory email round trip and a plan-and-card screen.
 *     "Start your books" is what the path actually is, and it is the same
 *     label on all three actions (01-cro HIGH; 09 theme C).
 *   - THE OFFER SAYS WHICH PLANS IT APPLIES TO. Annual checkouts get no
 *     intro month (lib/stripe/server.ts), and the fine line now says so
 *     the first time the offer appears (03-content MEDIUM).
 *   - THE OPERATOR READER IS NAMED. #for-operators, one row, written to
 *     the pilot's own buying decision. There is no operator account to
 *     sell — no operator tier, no operator schema, docs/MARKETING.md §2 —
 *     so the page's single conversion action stays pilot signup and the
 *     operator gets a sentence that lets them recognise themselves and
 *     stop, rather than a signup they would churn out of.
 *   - THE TRUST SHELF EXISTS. Claim rule 8 bans testimonials, counts and
 *     statistics, and this product genuinely has none, so PROMISES carries
 *     it: four facts the code enforces, including the zero-take-rate fact,
 *     which is the strongest compliant trust signal available and appeared
 *     nowhere (01-cro HIGH).
 *   - THE SPEC BLOCK MOVED BELOW THE FAQ, so the page alternates bands
 *     (brand / canvas / sunk / canvas / sunk / brand) and no stretch of it
 *     is more than two beats from a conversion action.
 *
 * docs/MARKETING.md was re-signed the same day for the hero fine line and
 * the new §6 budgets; it remains the authority for this copy, and §5's
 * claim rules carried forward UNCHANGED — they are honesty constraints,
 * not positioning choices.
 */

/**
 * The homepage's own title. Without this the page inherits the root
 * layout's bare `default` ("V1") — and "V1" is one of the most overloaded
 * words in this exact audience's vocabulary: the takeoff decision speed
 * every pilot searches and drills. The tagline distinguishes the result.
 * `absolute` so the root's "%s | V1" template doesn't double the brand;
 * both halves come from lib/brand.ts (claim rule 9).
 */
export const metadata: Metadata = {
  title: { absolute: `${BRAND.name} — ${BRAND.tagline}` },
};

/**
 * THE ONE OFFER, SPOKEN IDENTICALLY. Three buttons on this page start the
 * same funnel (hero, promises band, close) and they carry the same words,
 * because three labels for one action reads as three different offers.
 * The figure is interpolated from the constant checkout passes to Stripe,
 * per claim rule 11 — it is never typed here.
 */
const START_CTA = `Start your books — ${INTRO_FIRST_MONTH_LABEL} first month`;

/** Both /pricing links, hero and spec block, say the same thing too. */
const PRICING_CTA = "Compare plans";

/** A full-bleed band with the page's one shared measure inside it. */
function Band({
  children,
  tone = "canvas",
  glow = "top",
  id,
  measure = "default",
}: {
  children: React.ReactNode;
  /** `brand` is the navy ground, and it carries its own ink colour so a
   *  caller cannot half-apply it and leave dark text on dark. Since the
   *  2026-08-19 polish it also carries a glow field — the two brand blues
   *  as low-alpha orbs behind the content (see `glow`). */
  tone?: "canvas" | "sunk" | "brand";
  /** Which glow field a `brand` section carries: the hero's twin orbs or
   *  the close's low horizon. Ignored on the other tones. */
  glow?: "top" | "low";
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
            ? "relative overflow-hidden bg-brand text-brand-ink"
            : undefined
      }
    >
      {tone === "brand" ? (
        <div aria-hidden className={glow === "low" ? "mkt-glow-low" : "mkt-glow"} />
      ) : null}
      <div
        className={`relative mx-auto w-full ${width} px-5 py-16 sm:px-6 sm:py-24`}
      >
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
    // app/(app)/logbook/db.ts is per-leg, and the queue is titled "Trip
    // drafts — legs from completed trips". Per-leg is also how pilots and
    // every logbook product record flight time, which is the reason to
    // say it plainly here. This line does NOT rest on a regulatory
    // reading: 14 CFR 61.51(b) sets the data each logged flight must
    // carry, not the granularity of an entry, and an earlier version of
    // this comment overstated it. "The legs … a draft entry" read as a
    // merge, which is what the current wording avoids.
    body: "One draft per leg, with PIC and SIC kept separate. You review every draft before anything reaches your logbook.",
    shot: "logbook",
  },
  {
    step: "03",
    q: "What did it cost?",
    // "deductible expense records" DESCRIBES THE SOFTWARE. It must never
    // become "lowers your taxable income" or "is deductible": `deduct` is
    // an expense treatment enum (app/(app)/expenses/actions.ts), and the
    // product's own mileage screen says in as many words that it records
    // drives rather than determining what is deductible. This is the one
    // signed-out surface carrying no disclaimer, so a tax outcome asserted
    // here is asserted naked. See docs/MARKETING.md §5 rule 10.
    //
    // "FROM YOUR PHONE'S BROWSER" IS A SHIPPED FACT, not an aspiration.
    // The OCR engine runs client-side on assets served from this origin
    // (scripts/sync-ocr-assets.mjs copies them into public/ocr/), and the
    // capture input is a plain accept="image/*" file field, which on both
    // iOS and Android offers the camera — see the comment in
    // app/(app)/expenses/receipt-scan.tsx. There is no app to install
    // because there is no app; the clause says so without saying it.
    body: "Scan a receipt at the FBO from your phone’s browser and attach it to the trip. Mark it for client reimbursement or keep it with your deductible expense records.",
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
        // "payment links" added 2026-08-18: /pricing already claimed it and
        // this line did not, so the same feature was summarised by two
        // non-overlapping lists on the two public pages (03-content LOW).
        text: "Numbered invoice PDFs, payment links, email delivery, and view tracking",
        features: ["invoices"],
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

/**
 * THE TRUST SHELF, and why it is four sentences rather than a wall of
 * logos or a customer count. Claim rule 8 forbids testimonials, statistics
 * and customer numbers, and this product has none to forbid — it has not
 * launched. What it does have is four promises the CODE enforces, each
 * traceable to the thing that enforces it:
 *
 *   1. specGroups() above, and lib/entitlements.ts behind it. The page
 *      cannot advertise a feature into a plan that does not carry it.
 *   2. The cancel/downgrade promise — DOWNGRADE_NOTE, the /pricing FAQ,
 *      and scripts/account-lifecycle-verify.mjs, which is what keeps it
 *      true. Scoped to cancel and downgrade ONLY: the hold-lapse purge is
 *      a different path and stays documented on /pricing, not softened
 *      into this row.
 *   3. account_export at minTier "solo" (claim rule 6). "Every record type
 *      as CSV" is deliberate and it is the ceiling of the claim: uploaded
 *      receipt and document FILES are downloaded per record, not bundled
 *      into the export, so this row must never grow into "every file".
 *   4. docs/PRICING.md §6 — Stripe Connect Standard, zero application fee,
 *      the pilot is merchant of record. This is the page's single
 *      statement of the zero-take-rate fact and the only place it appears.
 */
const PROMISES: readonly string[] = [
  "If a feature isn’t in your plan, it isn’t on this page. The lists here are generated from the same rules the product enforces.",
  "Cancel or downgrade and nothing is deleted. The account goes read-only, and your records stay readable and exportable.",
  "The full account export is on every plan, Solo included: every record type as CSV.",
  `Client payments go straight to you. ${BRAND.name} adds no fee of its own and never holds the money.`,
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
 * FOUR QUESTIONS. Only the ones that remove a real barrier and are
 * answered nowhere else on the page. The second is non-negotiable: it
 * carries the substance of lib/brand.ts's counsel-reviewed
 * CURRENCY_DISCLAIMER — this product never presents itself as deciding
 * whether a pilot is legal to fly.
 *
 * That second answer is also the one string on this page under an OPEN
 * COUNSEL QUESTION, and it is deliberately unchanged. docs/MARKETING.md §5
 * rule 4 blesses the paraphrase ("the substance survives in the landing
 * FAQ"); docs/CURRENCY-SPEC.md §7 forbids any screen paraphrasing
 * CURRENCY_DISCLAIMER, and the word "airworthiness" is that spec's own
 * open question C-1 with an instruction not to move the wording either way
 * without sign-off. Two owner documents disagree, so the line ships as it
 * has shipped and goes to counsel with the Terms/Privacy gate (G3). Do not
 * reword it in passing.
 *
 * The fourth answers the data objection for a product that asks a pilot
 * for bank statements and income. Both of its claims are shipped
 * behaviour, not marketing: receipt OCR runs client-side on self-hosted
 * assets (scripts/sync-ocr-assets.mjs), and the bank-statement parse is
 * done in the browser by app/(app)/expenses/import/import-workspace.tsx
 * ("use client", FileReader, parseCsv/parseOfx) before anything is sent.
 * Both facts are also stated on /privacy, which is where a claim like this
 * has to be able to point.
 */
const FAQ: { q: string; a: string }[] = [
  {
    // "LogTen", not "LogTen Pro": Coradine was acquired in 2022 and the
    // product's own headings, navigation and App Store listing are
    // "LogTen" / "LogTen Pilot Logbook" today (logten.com, checked
    // 2026-08-18); "LogTen Pro" now survives on a footer copyright line
    // and in legacy API docs. Stale vendor branding is a credibility tell
    // in front of exactly this reader. The import screens in app/(app)
    // were corrected in the same change.
    q: "I already keep a logbook. Do I have to start over?",
    a: "No. Import a ForeFlight or LogTen export, or any CSV through the column mapper, and carry on from there.",
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
  {
    q: "Where do my records and receipts live?",
    a: "In your account, exportable in full whenever you want. Receipts are read in your browser when you scan them, and bank statements are parsed in your browser before anything is saved.",
  },
];

/**
 * "/" lives here rather than in app/(app) because that route group is
 * wrapped, unconditionally, by requireAccount(). A signed-in visitor is
 * bounced before any marketing copy renders: provisioned account -> the
 * dashboard, signed in with no account yet -> /welcome.
 */
export default async function LandingPage() {
  // The signed-in redirect check used to run unconditionally — a network
  // round trip to the Supabase Auth server before the hero could paint,
  // paid on every load by the first-touch visitors who have no session at
  // all (and this page's own budget is "ten seconds on FBO wifi",
  // docs/MARKETING.md §6). The auth cookie's presence is a local read:
  // @supabase/ssr stores the session as `sb-<project-ref>-auth-token`
  // (chunked cookies keep the same prefix and marker). No such cookie, no
  // possible session, no round trip. A stale or invalid cookie still takes
  // the full check and falls through to the marketing page exactly as
  // before.
  const cookieStore = await cookies();
  const mayBeSignedIn = cookieStore
    .getAll()
    .some(({ name }) => name.startsWith("sb-") && name.includes("-auth-token"));
  if (mayBeSignedIn) {
    const ctx = await getSessionContext();
    if (ctx?.account) redirect(DASHBOARD_PATH);
    if (ctx) redirect("/welcome");
  }

  const groups = specGroups();

  return (
    <>
      {/* ── 1. HERO ──────────────────────────────────────────────────────
          Navy, and asymmetric: the argument holds a 5-of-12 column and the
          product holds 7, rather than the headline sitting centered above a
          full-width screenshot. Stacks at lg and below. */}
      <Band tone="brand" measure="wide">
        <div className="grid grid-cols-1 items-center gap-10 xl:grid-cols-12 xl:gap-8">
          <Reveal className="flex flex-col items-start gap-5 xl:col-span-5">
            {/* Not an LPill: that primitive's whitespace-nowrap is right for
                a status badge ("Paid") and wrong for a phrase, which on a
                narrow phone just runs off the edge. */}
            <p className="font-mono text-caption font-medium tracking-widest text-brand-accent uppercase">
              For independent contract pilots
            </p>

            {/* THE page's only h1, and the only thing on the page set in
                --text-display. Owner-signed identity claim, docs/MARKETING.md
                §4: kept verbatim through the 2026-08-18 rewrite. */}
            <h1 className="mkt-display font-display font-bold text-brand-ink">
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
                className={lButtonClass({
                  size: "lg",
                  variant: "onBrand",
                  className: "group rounded-full pr-2",
                })}
              >
                {START_CTA}
                {/* The island orb — the arrow rides in its own well and
                    drifts toward the corner on hover (.mkt-orb). aria-hidden:
                    it decorates the label, it does not extend it. */}
                <span aria-hidden className="mkt-orb mkt-orb-onlight">
                  ↗
                </span>
              </NextLink>
              <NextLink
                href="/how-it-works"
                className={lButtonClass({
                  size: "lg",
                  variant: "onBrandOutline",
                  className: "rounded-full",
                })}
              >
                {PRICING_CTA}
              </NextLink>
            </div>

            {/* THE OFFER'S SCOPE, stated the first time the offer appears.
                lib/stripe/server.ts mints the intro coupon per MONTHLY price
                only — "a first month has no meaning on an invoice that bills
                a year at a time" — so an unqualified "$5 first month" beside
                a page that also sells annual plans is a price claim this
                product does not honour. docs/MARKETING.md's own history is
                why that matters: its "An offer change must sweep the SHELL"
                section exists because imprecise offer copy shipped three
                false price claims. Both figures interpolated (rule 11). */}
            <p className="text-caption text-brand-ink-2">
              Plans start at {TIER_PRICE_COPY.solo.monthly}/month; the{" "}
              {INTRO_FIRST_MONTH_LABEL} first month applies to monthly plans.
              Card required.
            </p>
          </Reveal>

          {/* THE PRODUCT VISUAL — a real capture of the real Overview
              screen, with invented data (see ./product-shot.tsx, and the
              harness it names). Floated on the navy rather than boxed into
              the text column: shadow-float exists because shadow-card's 4%
              is invisible against a dark field. Eager, not lazy — it is the
              fold. */}
          <Reveal delay={1} className="xl:col-span-7">
            <ProductShot slug="overview" onBrand priority />
          </Reveal>
        </div>
      </Band>

      {/* ── 2. WHAT THE ONE ENTRY DRIVES ─────────────────────────────────
          The mechanic, in four rows, ending on the year. The long-form
          version of this is /how-it-works; this band exists to earn the
          click rather than to replace it. */}
      <Band>
        <div className="flex flex-col gap-8">
          <Reveal className="flex max-w-2xl flex-col gap-4">
            <h2 className="mkt-display-s font-display font-bold text-ink">
              You log the trip once
            </h2>
            <div className="flex items-start gap-3 border-l-2 border-accent pl-4">
              <p className="text-body text-ink-2">
                Put in the client, the tail number, the legs you flew and how
                each day counted, whether that was a flight day or a travel
                day or standby. That's the only time you type any of it.
              </p>
            </div>
          </Reveal>

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

            {/* THE OPERATOR ROW — a coda on this ledger, deliberately
                carrying no step number: it is not a fourth question a trip
                answers, it is what leaves the account when one is billed.
                Same hairline rhythm so it belongs to the band.

                WHY IT IS HERE AND WHY IT IS ONE ROW. Owners, operators and
                management companies are real readers of this page, and they
                are the only readers who arrive already holding a V1 link.
                They are also the only readers who CANNOT convert: there is
                no operator account type in the schema, no operator tier in
                lib/entitlements.ts, and docs/MARKETING.md §2 excludes
                "operators buying for their pilots" in as many words. So this
                row is written to the pilot's own buying decision — what your
                clients get is part of what you are buying — while letting an
                operator recognise themselves in one sentence and stop. A
                full audience split was drafted and cut: it re-identified the
                pilot the eyebrow, H1 and subhead had already identified, and
                addressed operators in second person on a page they cannot
                buy from. The signup an operator would make here is the one
                that churns.

                #for-operators is a real anchor with real inbound links: it
                is where the token surfaces (/invoice, /estimate, /packet,
                /vendor) point a client who wants to know what V1 is, and it
                is the target of the operator-led hero variant kept in
                docs/reviews/10-landing-page-copy.md §1 Variant B. Renaming
                it breaks those. */}
            <div
              id="for-operators"
              className="grid scroll-mt-24 grid-cols-1 gap-x-8 gap-y-3 py-6 md:grid-cols-12 md:items-baseline"
            >
              <div className="md:col-span-4">
                <h3 className="font-display text-h3 font-semibold text-ink">
                  What your clients get
                </h3>
              </div>
              <div className="md:col-span-8">
                <p className="text-body text-ink">
                  Nothing for them to sign up for. The owners and operators you
                  bill get numbered invoices, estimates they can accept online,
                  and your current credentials and insurance, all as browser
                  links.
                </p>
              </div>
            </div>
          </div>
        </div>
      </Band>

      {/* ── 3. FOUR PROMISES ─────────────────────────────────────────────
          The trust band, and the page's mid-point conversion action. See
          PROMISES above for what enforces each line. Sunk ground, hairline
          rows, no icons: four sentences a reader can check, which is the
          only kind of proof this product is allowed to offer.

          The CTA is outline rather than filled on purpose — it is the quiet
          action at the trust peak, not a second hero. Its label is the hero's
          word for word: one offer, spoken identically. */}
      <Band tone="sunk">
        <div className="flex flex-col gap-8">
          <h2 className="mkt-display-s font-display font-bold text-ink">
            Four promises
          </h2>

          <div className="divide-y divide-hair border-t border-hair">
            {PROMISES.map((promise) => (
              <p key={promise} className="max-w-3xl py-5 text-body text-ink">
                {promise}
              </p>
            ))}
          </div>

          <div>
            <NextLink href="/signup" className={lButtonClass({ variant: "outline", className: "rounded-full" })}>
              {START_CTA}
            </NextLink>
          </div>
        </div>
      </Band>

      {/* ── 4. QUESTIONS PILOTS ASK US ───────────────────────────────────
          Native <details>/<summary> — works with no JavaScript, and is
          keyboard- and screen-reader-correct for free. */}
      <Band measure="narrow">
        <div className="flex flex-col gap-5">
          <h2 className="mkt-display-s font-display font-bold text-ink">
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

          {/* THE ONE LINE ON THIS PAGE THAT REACHES A PERSON. It sits under
              the FAQ rather than inside it because it is not a question a
              pilot asks: it is what to do when the four above did not cover
              theirs. Before BRAND.supportEmail existed the answer was to pay
              and find out, on a funnel with no trial — which is why it is
              set as its own bordered row at body size rather than as
              caption-grade fine print. It is the site's only support
              channel; it should not read like a footnote. */}
          <div className="rounded-lg border border-hair bg-sunk px-4 py-3">
            <p className="text-body text-ink-2">
              Something we didn&apos;t answer?{" "}
              <a
                href={`mailto:${BRAND.supportEmail}`}
                className="font-medium text-accent hover:underline"
              >
                Email {BRAND.supportEmail}
              </a>{" "}
              and a person will answer.
            </p>
          </div>

          <div>
            <NextLink href="/how-it-works" className={lButtonClass({ variant: "outline", className: "rounded-full" })}>
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
      <Band>
        <Reveal className="mkt-panel grid grid-cols-1 gap-8 px-6 py-10 sm:px-10 sm:py-12 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-5">
            <h2 className="mkt-display-s font-display font-bold text-ink">
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
        </Reveal>
      </Band>

      {/* ── 5. THE SPEC BLOCK ────────────────────────────────────────────
          Asymmetric and sticky: the heading holds a 4-of-12 column and stays
          put on a tall screen while the list moves, so the reader always
          knows what the list is answering. Every Pro/Business tag is derived
          from lib/entitlements.ts — see specGroups().

          It sits BELOW the FAQ as of the 2026-08-18 rewrite. That is a band
          decision, not a content one: with the promises band added, keeping
          the spec block in its old slot put two `sunk` bands back to back
          and left the FAQ as the page's last word before the close. */}
      <Band tone="sunk">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-4">
            {/* The pointer travels WITH the heading, which is what puts it
                above the feature list at every width: below lg this column
                is full-width and stacks over the list, and at lg and up it
                is the sticky rail beside it. The price anchor is never
                something the reader meets after the list. */}
            <div className="lg:sticky lg:top-24">
              <h2 className="mkt-display-s font-display font-bold text-ink">
                What else is in there
              </h2>
              {/* THE PRICE ANCHOR, qualitative by design: claim rule 11
                  forbids typed figures and no maintained constant carries a
                  day-rate comparison, so this is the one sentence on the
                  page that frames cost against something rather than
                  stating it. The framing is docs/PRICING.md §2.8's, vetted
                  there against the only vendor-published day-rate table
                  found (PIC ~$1,200 at the bottom of the range, treated as
                  directional). It is a PER-PILOT comparison, which is the
                  only comparison this page offers: a year of the most
                  expensive plan a single pilot can buy is under half of one
                  flight day at that bottom figure, seats are comingSoon and
                  appear nowhere here, and every plan's annual price is
                  lower still. Re-check the arithmetic against
                  ./pricing/pricing-model.ts if a price moves; if the
                  comparison stops holding, cut the sentence rather than
                  soften it. "Flight day" is the product's own day-type
                  vocabulary (the phase-9 migration's 'flight' / 'Flight
                  day'), not a synonym chosen for tone. */}
              <p className="mt-4 max-w-md text-body text-ink-2">
                Three plans: Solo, Pro, and Business. A year of the books costs
                less than half of one flight day&apos;s pay.
              </p>
              <NextLink
                href="/pricing"
                className={lButtonClass({
                  variant: "outline",
                  className: "mt-5 rounded-full",
                })}
              >
                {PRICING_CTA}
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

      {/* ── 6. CLOSE ─────────────────────────────────────────────────────
          Navy again, bookending the hero, and carrying what used to be a
          plans band of its own. The price is stated once on this page, in
          the hero; the close used to repeat the intro offer as well, which
          made it the third statement of a fact nobody disputed. What this
          adds instead is the export promise, which is the strongest trust
          claim the product has and is true on every tier (docs/MARKETING.md
          claim rule 6). */}
      <Band tone="brand" glow="low">
        <Reveal className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div className="flex max-w-xl flex-col gap-3">
            <h2 className="mkt-display-s font-display font-bold text-brand-ink">
              Start with your next trip.
            </h2>
            <p className="text-body text-brand-ink-2">
              {/* The last comma becomes ", and" because a bare .join(", ")
                  rendered "Solo, Pro, Business plans" — a conjunction-less
                  list at the page's final call to action. Still derived
                  from TIER_ORDER, so a tier rename can't strand a typed
                  name. */}
              {TIER_ORDER.map((tier) => TIER_DISPLAY[tier].name)
                .join(", ")
                .replace(/, (?=[^,]*$)/, ", and ")}{" "}
              plans, each with the full account export from day one.
            </p>
          </div>
          <NextLink
            href="/signup"
            className={lButtonClass({
              size: "lg",
              variant: "onBrand",
              className: "group shrink-0 rounded-full pr-2",
            })}
          >
            {START_CTA}
            <span aria-hidden className="mkt-orb mkt-orb-onlight">
              ↗
            </span>
          </NextLink>
        </Reveal>
      </Band>
    </>
  );
}
