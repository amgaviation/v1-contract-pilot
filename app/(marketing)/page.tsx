import { redirect } from "next/navigation";
import NextLink from "next/link";
import { LCard, LPill, lButtonClass } from "@/components/ledger";
import { BRAND } from "@/lib/brand";
import { DASHBOARD_PATH } from "@/lib/nav";
import { getSessionContext } from "@/lib/supabase/account";
import { TRIAL_PERIOD_DAYS } from "@/lib/stripe/server";
import {
  FEATURES,
  TIER_RANK,
  type FeatureId,
  type PlanTier,
} from "@/lib/entitlements";
import ProductMock from "./product-mock";
import {
  TIER_DISPLAY,
  TIER_ORDER,
  TIER_PRICE_COPY,
  isPubliclyClaimable,
} from "./pricing/pricing-model";

/**
 * THE PUBLIC FRONT DOOR. Read docs/MARKETING.md before changing a word
 * here: it carries the positioning, the message hierarchy, the claim
 * rules, and a per-section word budget this page is written to (~490
 * visible words).
 *
 * The three standing rules that bind the copy, restated because they are
 * the ones a well-meaning edit breaks:
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
 *   THE TAGLINE IS NOT A HEADLINE. BRAND.tagline stays in the footer and
 *   metadata. The hero names the product and the work it handles instead of
 *   repeating a slogan.
 *
 * Figures are interpolated, never typed: the trial is the SAME constant the
 * checkout passes to Stripe (lib/stripe/server.ts), and the amounts come
 * from ./pricing/pricing-model, the one marketing source for the
 * docs/PRICING.md §3.2 numbers.
 *
 * LEDGER PASS. The old two-tone navy/white register (a full-bleed gradient
 * hero, a matching CTA band, --v1-marketing-* custom properties) is
 * retired: Ledger has no "brand navy" token, and its signature move is
 * restraint rather than a dramatic dark panel. Every section below sits on
 * `bg-canvas`, alternating with `bg-sunk` for rhythm exactly the way the
 * old GRAY_BAND did — same alternation, Ledger's own quiet-fill token
 * instead of a bespoke one. One filled-accent action per section, per
 * LEDGER.md's marketing register rule; a second call to action, where the
 * copy needs one, is always the quieter `outline` variant.
 */

/** A full-bleed band with the page's one shared measure inside it. */
function Band({
  children,
  tone = "canvas",
  id,
  narrow = false,
}: {
  children: React.ReactNode;
  tone?: "canvas" | "sunk";
  id?: string;
  /** The FAQ band's measure is a reading column, not the page's full grid. */
  narrow?: boolean;
}) {
  return (
    <section id={id} className={tone === "sunk" ? "bg-sunk" : undefined}>
      <div
        className={
          narrow
            ? "mx-auto w-full max-w-3xl px-5 py-14 sm:px-6 sm:py-20"
            : "mx-auto w-full max-w-6xl px-5 py-14 sm:px-6 sm:py-20"
        }
      >
        {children}
      </div>
    </section>
  );
}

/**
 * WHAT ONE TRIP PRODUCES. Two generated, one organised — see the header.
 * The input card that feeds these three is rendered inline below; it is
 * the source, so it is the one card on the page with its own ground.
 */
const OUTPUTS: { step: string; title: string; body: string }[] = [
  {
    step: "01",
    title: "Invoice lines",
    body: "Your client’s rate and billable days are already there. Review the details, then send a numbered PDF invoice with a payment link.",
  },
  {
    step: "02",
    title: "Review the drafts",
    // ONE DRAFT PER LEG, not one per trip: draftPayloadForLeg() in
    // app/(app)/logbook/db.ts is per-leg, the queue is titled "Trip drafts —
    // legs from completed trips", and one entry per flight is the only form
    // 14 CFR 61.51 recognises. "The legs … a draft entry" read as a merge.
    body: "Each leg becomes a draft with PIC and SIC kept separate. You review it before anything is added to your logbook.",
  },
  {
    step: "03",
    title: "Send and file",
    // "lands in the year's deductible total" DESCRIBES THE SOFTWARE. It
    // must never become "lowers your taxable income" or "is deductible":
    // `deduct` is an expense treatment enum (app/(app)/expenses/actions.ts),
    // and the product's own mileage screen says in as many words that it
    // records drives rather than determining what is deductible. The front
    // door is the one signed-out surface with no disclaimer on it, so a tax
    // outcome asserted here is asserted naked. See docs/MARKETING.md §5
    // rule 10.
    body: "Scan a receipt at the FBO and attach it to the trip. Mark it for client reimbursement or keep it with your deductible expense records.",
  },
];

/**
 * THE SPEC BLOCK — one three-column list, grouped by the pilot's job.
 *
 * Each line declares the FeatureId(s) it describes, and that is what makes
 * the block honest without hand-maintenance:
 *
 *   - the tier tag is DERIVED from FEATURES[id].minTier, so a line can
 *     never read as included when the code gates it;
 *   - a line whose feature is not publicly claimable is dropped, so the
 *     counsel-gated currency board can never reappear here by edit;
 *   - a line whose feature entitlements marks comingSoon is dropped, which
 *     is why multi_seat appears nowhere on this page. The Business per-seat
 *     PRICE is a billing fact and may be stated (see the plans line);
 *     inviting a bookkeeper is not shipped and is claimed nowhere.
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
      {
        text: "Client rate cards and W-9 status",
        features: ["clients"],
      },
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
        // "the rate you set" is load-bearing. lib/mileage.ts stores
        // "that year's rate in cents per mile, AS THE PILOT ENTERED IT", and
        // a year with no rate on file renders miles with no dollar figure
        // ("no IRS rate on file for {year}", reports/quarterly). The product
        // ships no rate table; dropping the qualifier turned an input field
        // into an advertised capability.
        text: "Receipt scanning and mileage records using the annual rate you set",
        features: ["expenses"],
      },
      {
        text: "Medical, flight review, passport, and insurance dates",
        features: ["documents"],
      },
      {
        text: "CSV and OFX bank-statement imports",
        features: ["bank_import"],
      },
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
        // on that row in lib/entitlements.ts. This line is the correction of
        // the old page's overstated tiering; its tag is derived, so it
        // cannot drift back.
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
function specGroups(): { title: string; items: { text: string; tag: string | null }[] }[] {
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
 * "/" moved here from app/(app)/page.tsx because that route group is
 * wrapped, unconditionally, by app/(app)/layout.tsx's requireAccount() —
 * there is no way to make one route inside a gated layout render for a
 * signed-out visitor. A signed-in visitor is bounced before any marketing
 * copy renders: provisioned account -> the dashboard, signed in with no
 * account yet -> /welcome, exactly what requireAccount() would have done.
 */
export default async function LandingPage() {
  const ctx = await getSessionContext();
  if (ctx?.account) redirect(DASHBOARD_PATH);
  if (ctx) redirect("/welcome");

  const groups = specGroups();

  return (
    <>
      {/* 1. HERO — ten seconds: what it is, what it does, who it's for,
          what it costs — then the mock, which does the explaining. */}
      <Band>
        <div className="flex flex-col gap-6">
          <div className="flex max-w-3xl flex-col items-start gap-4">
            {/* Not an LPill: that primitive's whitespace-nowrap is correct
                for a short status badge ("Paid", "Overdue") and wrong for a
                sentence — a pill that cannot wrap just runs off the edge of
                a phone. Plain eyebrow text instead, which wraps normally. */}
            <p className="text-caption font-semibold text-accent">
              BUSINESS SOFTWARE FOR PILOTS
            </p>

            {/* THE page's only h1. Ledger's type scale is fixed rather than
                responsive per breakpoint (docs/design/LEDGER.md), so this
                renders at the same text-h1 size the rest of the migration
                uses for a page's one h1, rather than the old Radix
                responsive size="{8,9}" step. */}
            <h1 className="text-h1 font-bold tracking-tight text-ink">
              Stop entering the same trip three times.
            </h1>

            <p className="text-lead text-ink-2">
              {BRAND.name} keeps your trips, invoices, logbook, receipts, and year-end
              records together—so the business side of flying takes less work.
            </p>

            <div className="mt-1 flex flex-wrap gap-3">
              <NextLink href="/signup" className={lButtonClass({ size: "lg" })}>
                Try {BRAND.name} free for {TRIAL_PERIOD_DAYS} days
              </NextLink>
              <NextLink href="/pricing" className={lButtonClass({ size: "lg", variant: "outline" })}>
                View plans
              </NextLink>
            </div>

            <p className="text-caption text-ink-3">
              Plans start at {TIER_PRICE_COPY.solo.monthly}/month. Card required.
            </p>
          </div>

          {/* THE PRODUCT VISUAL, above the fold. Built from the product's
              own components with invented data — see product-mock.tsx. */}
          <ProductMock />

          <p className="text-caption text-ink-3">Illustrative data.</p>
        </div>
      </Band>

      {/* 2. WHAT ONE TRIP PRODUCES. The proof, immediately: one input card
          feeding three numbered outputs. Anchor target for the header's
          link. */}
      <Band id="how-it-works" tone="sunk">
        <div className="flex flex-col gap-5">
          <h2 className="text-h2 font-bold tracking-tight text-ink">Finish the paperwork while the trip is fresh</h2>

          <div className="rounded-card border border-accent-soft bg-accent-soft p-5">
            <p className="mb-1 text-caption font-semibold text-accent">START WITH THE TRIP</p>
            <p className="text-body text-ink">
              Add the client, aircraft, legs, and your flight, travel, standby,
              or off days.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {OUTPUTS.map((output) => (
              <LCard key={output.title}>
                <div className="mb-1 flex items-center gap-2">
                  <span className="tnum-l text-h3 font-bold text-accent">{output.step}</span>
                  <h3 className="text-h3 font-semibold text-ink">{output.title}</h3>
                </div>
                <p className="text-body-s text-ink-2">{output.body}</p>
              </LCard>
            ))}
          </div>
        </div>
      </Band>

      {/* 3. WHAT'S IN IT. One three-column spec block, grouped by the
          pilot's job, every Pro/Business line tagged from the code. */}
      <Band>
        <div className="flex flex-col gap-5">
          <h2 className="text-h2 font-bold tracking-tight text-ink">
            What you can manage in {BRAND.name}
            The rest of the job, in the same place.
          </h2>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {groups.map((group) => (
              <LCard key={group.title}>
                <p className="mb-3 text-caption font-semibold text-accent">
                  {group.title.toUpperCase()}
                </p>
                <ul className="flex flex-col gap-3">
                  {group.items.map((item) => (
                    <li key={item.text} className="flex items-start gap-2">
                      <span aria-hidden className="text-body-s font-medium text-accent">
                        —
                      </span>
                      <span className="text-body-s text-ink">
                        {item.text}
                        {/* The tier tag is a pill, not a suffix in gray: a
                            reader scanning for what their plan includes has
                            to be able to find it without reading the line.
                            Its VALUE is derived from entitlements — see
                            specGroups() — so it cannot claim the wrong
                            tier. */}
                        {item.tag ? (
                          <>
                            {" "}
                            <LPill tone="neutral">{item.tag}</LPill>
                          </>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </LCard>
            ))}
          </div>
        </div>
      </Band>

      {/* 4. PLANS. Prices come from the same public model as /pricing. */}
      <Band tone="sunk">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-h2 font-bold tracking-tight text-ink">Simple monthly plans</h2>
              <p className="mt-2 text-body text-ink-2">
                Every plan includes the {TRIAL_PERIOD_DAYS}-day trial and a full account export.
              </p>
            </div>
            <NextLink href="/pricing" className={lButtonClass({ variant: "outline" })}>
              Compare all features
            </NextLink>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {TIER_ORDER.map((tier) => (
              <LCard key={tier}>
                <p className="text-body font-semibold text-ink">{TIER_DISPLAY[tier].name}</p>
                <p className="mt-2 text-h2 font-bold text-ink">
                  {TIER_PRICE_COPY[tier].monthly}
                  <span className="text-body-s font-normal text-ink-2">
                    {TIER_PRICE_COPY[tier].unit === "per seat" ? " / seat / month" : " / month"}
                  </span>
                </p>
                {TIER_PRICE_COPY[tier].unit === "per seat" ? (
                  <p className="mt-1 text-caption text-ink-3">
                    {TIER_PRICE_COPY[tier].seatMinimum}-seat minimum
                  </p>
                ) : null}
              </LCard>
            ))}
          </div>
        </div>
      </Band>

      {/* 5. BEFORE YOU SIGN UP. Native <details>/<summary> — works with
          no JavaScript, keyboard- and screen-reader-correct for free. */}
      <Band narrow>
        <div className="flex flex-col gap-4">
          <h2 className="text-h2 font-bold tracking-tight text-ink">Questions pilots ask us</h2>
          <div>
            {FAQ.map((item) => (
              <details key={item.q} className="border-b border-hair">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="text-body font-medium text-ink">{item.q}</span>
                  <span aria-hidden className="shrink-0 text-body text-ink-3">
                    +
                  </span>
                </summary>
                <p className="pb-4 pr-5 text-body-s text-ink-2">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </Band>

      {/* 6. CLOSING CTA. One line, one filled action. Trial length, price
          and card-required were stated in the hero and again in plans; a
          fourth statement is not persuasion, it is noise. */}
      <Band>
        <div className="rounded-card border border-accent-soft bg-accent-soft p-6 sm:p-8">
          <div className="flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
            <h2 className="text-h2 font-bold tracking-tight text-ink">Put your next trip in {BRAND.name}.</h2>
            <div className="flex shrink-0 flex-wrap gap-3">
              <NextLink href="/signup" className={lButtonClass({ size: "lg" })}>
                Try {BRAND.name} free for {TRIAL_PERIOD_DAYS} days
              </NextLink>
              <NextLink href="/pricing" className={lButtonClass({ size: "lg", variant: "outline" })}>
                Compare plans
              </NextLink>
            </div>
          </div>
        </div>
      </Band>
    </>
  );
}
