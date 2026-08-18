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
 *   logbook draft. Receipts are ORGANISED by it — nothing in this product
 *   creates an expense from a trip. Never claim three generated.
 *
 *   NOTHING BEYOND SHIPPED CODE. Every feature line below is tied to a
 *   FeatureId in lib/entitlements.ts, so its tier tag is derived rather
 *   than typed, and anything the public-claim filter removes (the
 *   counsel-gated currency board) or entitlements marks comingSoon (seats)
 *   disappears from this page mechanically. See specGroups() below.
 *
 *   THE TAGLINE IS NOT A HEADLINE. BRAND.tagline stays in the footer, the
 *   auth column and metadata. The hero names the product and the work it
 *   handles instead of repeating a slogan.
 *
 * Figures are interpolated, never typed: the trial is the SAME constant the
 * checkout passes to Stripe (lib/stripe/server.ts), and the amounts come
 * from ./pricing-model, the one marketing source for docs/PRICING.md §3.2.
 *
 * ── DESIGN, 2026-08-17 (unchanged by the angle change below) ─────────
 *
 * The page's structure is the redesign that shipped that morning: a navy
 * hero (--ledger-brand, the kit's own ground) with the mock beside the
 * argument, a hairline record ledger, an asymmetric spec block with a
 * sticky heading column, a narrow FAQ, and a navy close bookending the
 * hero. Display sizes (--text-display/-s) and the display/mono faces are
 * that redesign's too. One section is a grid, and it earns it.
 *
 * ── THE ANGLE CHANGE, 2026-08-17 (same day, owner's direction) ─────────
 *
 * The workflow wedge is retired. The page no longer argues "log the trip
 * once" / "stop entering the same trip three times" — the owner pulled
 * that positioning entirely. The page now argues the MONEY POSITION:
 * BRAND.name is the books for a flying business of one, and the hero
 * leads with what the books hold (who owes you, what you earned, what
 * you spent, the year-end packet) instead of with data entry saved. The
 * trip-native mechanic did not go anywhere — it is the product — but it
 * moved from headline to proof: section 2 frames the three records as the
 * three money questions a trip answers. This is also the page's words
 * finally agreeing with its own picture: the mock has always led with
 * Unbilled work / Awaiting payment / Paid this year.
 *
 * The old middle column ("Today: retyped into an invoicing tool…") is
 * GONE, not reworded — it existed to serve the duplicate-entry argument.
 * Claim rule 7 (any comparison is workflow-only, no competitor named)
 * stays binding on whatever comparison a future edit might add.
 *
 * docs/MARKETING.md was rewritten the same day and is the authority for
 * this copy; §5's claim rules carried forward UNCHANGED — they are
 * honesty constraints, not positioning choices.
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
   *
   * (The old floor this comment recorded — a 42rem min-width on the
   * hand-built mock, which would have sliced the panel down the middle
   * below it — is gone with the mock. An image simply scales.)
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
      <div
        className={`mx-auto w-full ${width} px-5 py-14 sm:px-6 sm:py-20`}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * THE THREE QUESTIONS a trip answers, in the order a business asks them.
 * Two generated, one organised (see the file header): invoice lines are
 * GENERATED, the logbook draft is DRAFTED per leg, receipts are FILED by
 * the pilot — the bodies below say exactly that and nothing more. The old
 * "Today: retyped into…" comparison column is gone with the angle that
 * needed it; claim rule 7 (workflow only, no competitor named) binds any
 * comparison a future edit reintroduces.
 */
/**
 * TWO OF THE THREE CARRY A SCREENSHOT, and only where the picture answers
 * the same question the words do: the invoice screen beside "What am I
 * owed?", the logbook beside "What did I fly?". Row 03 deliberately has
 * none — a receipt-scanning screen next to copy about filing receipts adds
 * nothing the sentence does not already say, and a third figure in one band
 * would turn a ledger of question-and-answer into a gallery.
 *
 * They render inside the answer column, at a constrained measure. These are
 * supporting figures, not heroes: the hero is the hero.
 */
const RECORDS: { step: string; q: string; body: string; shot?: ShotSlug }[] = [
  {
    step: "01",
    q: "What am I owed?",
    body: "Your client’s rate and billable days are already filled in. Review the lines, then send a numbered PDF invoice with a payment link.",
    shot: "invoice",
  },
  {
    step: "02",
    q: "What did I fly?",
    // ONE DRAFT PER LEG, not one per trip: draftPayloadForLeg() in
    // app/(app)/logbook/db.ts is per-leg, the queue is titled "Trip drafts —
    // legs from completed trips", and one entry per flight is the only form
    // 14 CFR 61.51 recognises. "The legs … a draft entry" read as a merge.
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
    body: "Scan a receipt at the FBO and attach it to the trip. Mark it for client reimbursement or keep it with your deductible expense records.",
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
    title: "The trip",
    items: [
      { text: "Clients, aircraft, legs, and day types", features: ["trips"] },
      { text: "Client rate cards and W-9 status", features: ["clients"] },
      {
        text: "Numbered invoice PDFs, email delivery, and view tracking",
        features: ["invoices"],
      },
      {
        text: "Estimates, recurring invoices, and client statements",
        features: ["estimates", "recurring_invoices", "client_statements"],
      },
    ],
  },
  {
    title: "Your records",
    items: [
      {
        text: "Logbook with separate PIC and SIC time, plus CSV import and export",
        features: ["logbook"],
      },
      {
        // "the rate you set" is load-bearing. lib/mileage.ts stores that
        // year's rate in cents per mile AS THE PILOT ENTERED IT, and a year
        // with no rate on file renders miles with no dollar figure. The
        // product ships no rate table; dropping the qualifier turns an
        // input field into an advertised capability.
        text: "Receipt scanning and mileage records using the annual rate you set",
        features: ["expenses"],
      },
      {
        text: "Medical, flight review, passport, and insurance dates",
        features: ["documents"],
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
 * THREE QUESTIONS. Only the ones that remove a real barrier and are
 * answered nowhere else on the page. The second is non-negotiable: it
 * carries the substance of lib/brand.ts's counsel-reviewed
 * CURRENCY_DISCLAIMER — this product never presents itself as deciding
 * whether a pilot is legal to fly.
 */
const FAQ: { q: string; a: string }[] = [
  {
    q: "I already keep a logbook. Do I have to start over?",
    a: "No. Import a ForeFlight or LogTen Pro export, or any CSV through the column mapper, and carry on from there.",
  },
  {
    q: "Does it decide whether I'm current or legal to fly?",
    a: "No, and it will never present itself that way. It tracks the expiry dates you entered off your own documents so you can see what's coming. Currency and airworthiness decisions stay yours.",
  },
  {
    q: "What happens if I cancel or downgrade?",
    a: "Nothing is deleted. Downgrading stops new work on the screens your plan no longer includes; cancelling puts the account in read-only. A pilot's logbook is a legal record; a lapsed card will never be the thing that destroys one.",
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
          full-width screenshot. Stacks at lg and below, where the mock goes
          under the buttons the way it always did. */}
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
              Flying is the job. This is the business.
            </h1>

            <p className="text-lead text-brand-ink-2">
              {BRAND.name} keeps the books for your flying business: who owes
              you, what you earned, what you spent, and the year-end packet
              your CPA asks for. All of it comes off the trips you fly.
            </p>

            <div className="mt-1 flex flex-wrap gap-3">
              <NextLink
                href="/signup"
                className={lButtonClass({ size: "lg", variant: "onBrand" })}
              >
                Try {BRAND.name} — {INTRO_FIRST_MONTH_LABEL} first month
              </NextLink>
              <NextLink
                href="/pricing"
                className={lButtonClass({
                  size: "lg",
                  variant: "onBrandOutline",
                })}
              >
                View plans
              </NextLink>
            </div>

            <p className="text-caption text-brand-ink-2">
              Plans start at {TIER_PRICE_COPY.solo.monthly}/month. Card
              required.
            </p>
          </div>

          {/* THE PRODUCT VISUAL — a real capture of the real Overview
              screen, with invented data (see ./product-shot.tsx, and the
              harness it names). It replaced a hand-built approximation of
              the same dashboard: same panels, same figures, but drawn
              rather than photographed, and therefore free to drift from
              the product the moment either changed.

              Floated on the navy rather than boxed into the text column:
              shadow-float exists because shadow-card's 4% is invisible
              against a dark field. Eager, not lazy — it is the fold. */}
          <div className="xl:col-span-7">
            <ProductShot slug="overview" onBrand priority />
          </div>
        </div>
      </Band>

      {/* ── 2. WHAT A TRIP IS WORTH ──────────────────────────────────────
          The mechanic as proof: three money questions, answered off the
          trip record. Two generated, one organised still governs every
          body below. Anchor target for the header's "How it works". */}
      <Band id="how-it-works">
        <div className="flex flex-col gap-8">
          <div className="flex max-w-2xl flex-col gap-4">
            <h2 className="font-display text-display-s font-bold text-ink">
              What a trip is worth
            </h2>
            <div className="flex items-start gap-3 border-l-2 border-accent pl-4">
              <p className="text-body text-ink-2">
                <span className="font-semibold text-ink">
                  Start with the trip.
                </span>{" "}
                Add the client, aircraft, legs, and your flight, travel,
                standby, or off days. The three answers below come from that
                record.
              </p>
            </div>
          </div>

          {/* Hairline-separated rows, not cards: a ledger of question and
              answer, which is the shape the product itself uses for money.
              Three bordered boxes side by side is the template shape this
              page deliberately does not have. */}
          <div className="divide-y divide-hair border-t border-hair">
            {RECORDS.map((row) => (
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
                      the answer's evidence, so it sits inside the answer
                      rather than taking the row. */}
                  {row.shot ? (
                    <ProductShot slug={row.shot} className="max-w-2xl" />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Band>

      {/* ── 3. THE SPEC BLOCK ────────────────────────────────────────────
          Asymmetric and sticky: the heading holds a 4-of-12 column and stays
          put on a tall screen while the list moves, so the reader always
          knows what the list is answering. Every Pro/Business tag is derived
          from lib/entitlements.ts — see specGroups(). */}
      <Band tone="sunk">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-4">
            <div className="lg:sticky lg:top-24">
              <h2 className="font-display text-display-s font-bold text-ink">
                The rest of the books
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

      {/* ── 4. BEFORE YOU SIGN UP ────────────────────────────────────────
          Native <details>/<summary> — works with no JavaScript, and is
          keyboard- and screen-reader-correct for free. */}
      <Band measure="narrow">
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
        </div>
      </Band>

      {/* ── 5. CLOSE ─────────────────────────────────────────────────────
          Navy again, bookending the hero, and carrying what used to be a
          plans band of its own. The price is stated once on this page, in
          the hero; repeating it here would be the third statement of a fact
          nobody disputed. What this adds instead is the export promise,
          which is the strongest trust claim the product has and is true on
          every tier (docs/MARKETING.md claim rule 6). */}
      <Band tone="brand">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div className="flex max-w-xl flex-col gap-3">
            <h2 className="font-display text-display-s font-bold text-brand-ink">
              Start the books with your next trip.
            </h2>
            <p className="text-body text-brand-ink-2">
              {TIER_ORDER.map((tier) => TIER_DISPLAY[tier].name).join(", ")}{" "}
              plans, every one of them {INTRO_FIRST_MONTH_LABEL} for the first
              month, with a full account export.
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
