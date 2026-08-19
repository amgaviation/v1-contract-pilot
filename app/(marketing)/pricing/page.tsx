import NextLink from "next/link";
import { LCard, LSeparator, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { BRAND } from "@/lib/brand";
import { INTRO_FIRST_MONTH_LABEL } from "@/lib/stripe/server";
import Reveal from "../reveal";
import {
  BUSINESS_MINIMUM_MONTHLY,
  TIER_DISPLAY,
  TIER_ORDER,
  TIER_PRICE_COPY,
  publicCoreFeatures,
  publicMatrix,
  publicTierAdds,
  type MatrixRow,
  type PlanTier,
} from "./pricing-model";

/**
 * THE THREE-TIER PRICING PAGE. The depth on this page is the MATRIX, which
 * is generated, so the prose around it earns nothing by being long.
 *
 * Feature split, tier names and blurbs render from lib/entitlements.ts (via
 * ./pricing-model — see that file for the one public-claim filter it adds),
 * so this page and the product's own gating can never disagree about what a
 * plan includes.
 *
 * AMOUNTS. No dollar figure is typed on this page: they come from
 * ./pricing-model's TIER_PRICE_COPY, which is also what the landing page
 * renders, so the two public pages cannot drift. This page deliberately
 * does NOT read the live Stripe Price objects the way the welcome picker
 * and settings/billing do (lib/stripe/prices.ts) — read pricing-model.ts's
 * header for why: a public page has to render at build time, on a preview
 * deployment, and on a machine with no Stripe key, and a pricing page that
 * says "unavailable" to a stranger is worse than one rendering the signed
 * docs/PRICING.md §3.2 numbers. The Stripe Price object remains what
 * actually charges the card, and every PRE-PURCHASE surface — where the
 * figure shown must equal the charge — reads it live.
 *
 * Standing claim rules, absolute: nothing here may imply an unshipped
 * feature exists (rows entitlements marks comingSoon render AS coming soon,
 * and the counsel-gated currency board is absent entirely), and no copy may
 * state or imply the product determines whether a pilot is legal to fly.
 *
 * LEDGER PASS: see ../page.tsx's own header for why the navy register is
 * retired throughout this route group.
 */

export const metadata = {
  title: "Pricing",
  description:
    `Three plans for the independent contract pilot: Solo, Pro and ` +
    `Business. Your own records are in every plan, and every plan starts ` +
    `at ${INTRO_FIRST_MONTH_LABEL} for the first month.`,
};

/** A full-bleed band with the page's one shared measure inside it. */
function Band({
  children,
  tone = "canvas",
  narrow = false,
}: {
  children: React.ReactNode;
  tone?: "canvas" | "sunk";
  narrow?: boolean;
}) {
  return (
    <section className={tone === "sunk" ? "bg-sunk" : undefined}>
      <div
        className={
          narrow
            ? "mx-auto w-full max-w-2xl px-4 py-14 sm:py-20"
            : "mx-auto w-full max-w-5xl px-4 py-14 sm:py-20"
        }
      >
        {children}
      </div>
    </section>
  );
}

/** Per-tier price presentation, derived from the shared copy table. */
function priceLine(tier: PlanTier): {
  amount: string;
  per: string;
  annual: string;
} {
  const copy = TIER_PRICE_COPY[tier];
  if (copy.unit === "per seat") {
    return {
      amount: copy.monthly,
      per: "/seat/month",
      annual: `${copy.annual}/seat/year on annual, two months free`,
    };
  }
  return {
    amount: copy.monthly,
    per: "/month",
    annual: `${copy.annual}/year on annual, two months free`,
  };
}

/** What each card lists, and the line that introduces the list. */
function cardFeatures(tier: PlanTier) {
  if (tier === "solo") {
    return { intro: "The whole working core:", items: publicCoreFeatures() };
  }
  if (tier === "pro") {
    return { intro: "Everything in Solo, plus:", items: publicTierAdds("pro") };
  }
  return { intro: "Everything in Pro, plus:", items: publicTierAdds("business") };
}

export default function PricingPage() {
  const matrix = publicMatrix();

  return (
    <>
      {/* HERO */}
      <Band>
        <Reveal className="flex max-w-3xl flex-col items-start gap-4">
          <p className="font-mono text-caption font-medium uppercase tracking-widest text-accent">Pricing</p>
          <h1 className="mkt-display-s font-display font-bold text-ink">Three plans. One record.</h1>
          <p className="text-lead text-ink-2">
            Every plan runs the same trip record, so the invoice, the
            logbook drafts and the year-end numbers work the same on all
            three. The higher plans add business depth on top of that, and
            your logbook, your documents and your export are in all of them.
          </p>
          <p className="text-caption text-ink-3">
            {INTRO_FIRST_MONTH_LABEL} for your first month, on every plan.
            The regular price applies from month two.
          </p>
        </Reveal>
      </Band>

      {/* THE THREE CARDS. Names, blurbs and feature lists come from
          lib/entitlements.ts via the view-model — not a hand-kept list. */}
      <Band>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:items-stretch">
          {TIER_ORDER.map((tier) => {
            const display = TIER_DISPLAY[tier];
            const price = priceLine(tier);
            const features = cardFeatures(tier);
            return (
              <LCard key={tier} className="flex h-full flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <h3 className="text-h3 font-semibold text-ink">{display.name}</h3>
                  <p className="text-body-s text-ink-2">{display.blurb}</p>
                </div>

                <div className="flex flex-col gap-0.5">
                  <div className="flex items-baseline gap-1">
                    <span className="tnum-l text-figure font-bold tracking-tight text-ink">
                      {price.amount}
                    </span>
                    <span className="text-body-s text-ink-2">{price.per}</span>
                  </div>
                  <p className="text-caption text-ink-3">{price.annual}</p>
                  {tier === "business" ? (
                    <p className="text-caption text-ink-3">
                      Two-seat minimum: {BUSINESS_MINIMUM_MONTHLY}/month
                      covers both seats.
                    </p>
                  ) : null}
                </div>

                <LSeparator className="my-0" />

                <div className="flex flex-1 flex-col gap-2">
                  <p className="text-caption font-medium text-ink-3">
                    {features.intro.toUpperCase()}
                  </p>
                  {features.items.map((item) => (
                    <div key={item.id} className="flex items-start gap-2">
                      <span aria-hidden className="text-body-s font-medium text-accent">
                        —
                      </span>
                      <span className="text-body-s text-ink">
                        {item.label}
                        {item.comingSoon ? (
                          <span className="text-caption text-ink-3"> (coming soon)</span>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>

                <NextLink href="/signup" className={lButtonClass({ className: "w-full rounded-full" })}>
                  Start for {INTRO_FIRST_MONTH_LABEL}
                </NextLink>
              </LCard>
            );
          })}
        </div>
      </Band>

      {/* FULL COMPARISON MATRIX — rendered row by row from the same
          entitlements source the product enforces with. */}
      <Band tone="sunk">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h2 className="font-display text-h2 font-bold tracking-tight text-ink">Every feature, every plan</h2>
            <p className="text-body-s text-ink-2">
              Generated from the plan definitions the product enforces with.
              Everything unmarked is live today; anything not yet shipped
              says so in its row.
            </p>
          </div>

          <LCard>
            <LTable className="min-w-[40rem]">
              <caption className="sr-only">
                Every feature, and which of the three plans includes it.
              </caption>
              <thead>
                <tr>
                  <LTh scope="col" className="w-[46%]">
                    Feature
                  </LTh>
                  {TIER_ORDER.map((tier) => (
                    <LTh key={tier} scope="col" className="text-center">
                      {TIER_DISPLAY[tier].name}
                    </LTh>
                  ))}
                </tr>
              </thead>
              {/* One tbody per band, so a row's tier behaviour is legible from
                  where it sits rather than by tracking three glyphs across.
                  Bands are DERIVED from the same availability the rows carry
                  (groupMatrix below) — no second list to keep in step. */}
              {groupMatrix(matrix).map((band) => (
                <tbody key={band.title}>
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={1 + TIER_ORDER.length}
                      className="border-b border-hair pt-6 pb-2 text-left text-caption font-semibold uppercase tracking-wide text-ink-3 first:pl-0"
                    >
                      {band.title}
                    </th>
                  </tr>
                  {band.rows.map((row) => (
                    <tr key={row.feature}>
                      <LTd>
                        {row.label}
                        {row.comingSoon ? (
                          <span className="text-caption text-ink-3"> (coming soon)</span>
                        ) : null}
                      </LTd>
                      {TIER_ORDER.map((tier) => (
                        <LTd key={tier} className="text-center">
                          {row.availability[tier] ? (
                            <span className="font-medium text-accent" aria-label="Included">
                              ✓
                            </span>
                          ) : (
                            <span className="text-ink-3" aria-label="Not included">
                              —
                            </span>
                          )}
                        </LTd>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </LTable>
          </LCard>
        </div>
      </Band>

      {/* FAQ — the questions a card is entered against, and nothing else. */}
      <Band>
        {/* The rail architecture the landing page's sections share
            (2026-08-19 second structural pass): the heading holds a
            sticky 4-col rail, the questions the 8-col track. The band
            left its narrow measure with the split — the rail supplies
            the reading-width restraint the narrow column used to. */}
        <div className="grid grid-cols-1 gap-x-12 gap-y-4 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <h2 className="font-display text-h2 font-bold tracking-tight text-ink lg:sticky lg:top-24">Before you enter a card</h2>
          </div>
          <div className="lg:col-span-8">
            {buildFaq().map((item) => (
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

      {/* CLOSING CTA BAND. */}
      <Band>
        <Reveal className="mkt-panel p-6 sm:p-9">
          <div className="flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
            <h2 className="mkt-display-s font-display font-bold text-ink">Start with your next trip.</h2>
            <NextLink
              href="/signup"
              className={lButtonClass({
                size: "lg",
                className: "group shrink-0 rounded-full pr-2",
              })}
            >
              Start for {INTRO_FIRST_MONTH_LABEL}
              <span aria-hidden className="mkt-orb mkt-orb-onaccent">
                ↗
              </span>
            </NextLink>
          </div>
        </Reveal>
      </Band>
    </>
  );
}

/**
 * The matrix, split into the three bands a reader is actually comparing.
 *
 * WHY THIS EXISTS. The matrix arrives in entitlements' own order, which is
 * feature order, not tier order — so "Account-wide CSV export" (in every
 * plan, deliberately: gating export is the one upsell this product
 * refuses) rendered stranded between the Pro-only rows and the
 * Business-only ones. A reader scanning for "what does Pro actually add"
 * had to read three glyphs on every row and hold the pattern in their head,
 * and the one row that contradicted its neighbours looked like a mistake.
 *
 * DERIVED, NEVER DECLARED. A band is computed from the row's own
 * availability, so a feature that changes tier in lib/entitlements.ts moves
 * band here with no edit — the failure mode of a hand-kept grouping is that
 * it silently disagrees with the table it labels, which is the exact class
 * of drift this page's generation-from-entitlements exists to prevent.
 */
function groupMatrix(rows: MatrixRow[]): { title: string; rows: MatrixRow[] }[] {
  const bands: { title: string; test: (row: MatrixRow) => boolean }[] = [
    { title: "In every plan", test: (row) => row.availability.solo },
    { title: "Pro adds", test: (row) => !row.availability.solo && row.availability.pro },
    {
      title: "Business adds",
      test: (row) => !row.availability.solo && !row.availability.pro,
    },
  ];

  return bands
    .map((band) => ({ title: band.title, rows: rows.filter(band.test) }))
    .filter((band) => band.rows.length > 0);
}

/**
 * FAQ copy. The downgrade and cancellation answers carry the memo's own
 * commitments (docs/PRICING.md §5): data is never deleted, read-only with
 * export working is the norm, and no plan change touches the records that
 * live in every tier.
 *
 * THE EXPORT ANSWER WAS CORRECTED IN THE 2026-08 REWRITE AND MUST STAY
 * CORRECTED: account_export is minTier "solo" in lib/entitlements.ts, with
 * an explicit comment recording that it was moved there deliberately —
 * "Gating export is the one upsell this product refuses." Do not narrow
 * this answer back to "Pro and Business add the account-wide export".
 */
function buildFaq(): { q: string; a: string }[] {
  return [
    {
      q: "What does the first month cost?",
      a: `${INTRO_FIRST_MONTH_LABEL}, on any monthly plan. From the second month your card is charged the regular price for the plan you picked: ${TIER_PRICE_COPY.solo.monthly}, ${TIER_PRICE_COPY.pro.monthly}, or ${TIER_PRICE_COPY.business.monthly} per seat a month. Annual plans bill the plain annual price from day one. Cancel during the first month and nothing more is charged: the ${INTRO_FIRST_MONTH_LABEL} you already paid isn't refunded, and the account stays open until that first month ends.`,
    },
    {
      q: "What happens if I downgrade or cancel?",
      a: "Nothing is deleted. Downgrading closes the screens your new plan doesn't include (those come straight back the moment you upgrade), but every record you already created stays in the account-wide export the whole time, on any plan. Cancelling puts the account in read-only: everything stays viewable and exportable there too. A pilot's logbook is a legal record; a lapsed card will never be the thing that destroys one.",
    },
    {
      q: "What happens if I put my account on hold?",
      a: "A hold pauses billing for up to two months and puts your records in read-only. Nothing is deleted while it runs, and you can end it early whenever you want. If a hold runs the full two months and isn't resumed or paid for, the business side is cleared — clients, trips, invoices, estimates, expenses and the accounting ledger. Your logbook, your documents, your aircraft and your operator qualifications are kept whatever happens: those are your records as an airman, not ours to delete over a subscription. The export works throughout, and we tell you before anything goes.",
    },
    {
      q: "Can I get my data out?",
      a: "On every plan. The account-wide export in Settings writes one CSV per record type, so you get a file each for clients, trips, trip days and trip legs, and the same again for estimates, invoices, payments, expenses, mileage and documents. The logbook exports in full, every report downloads, and the receipt and document files you uploaded download from their own pages.",
    },
    {
      // NEW 2026-08-19. Stripe Connect has shipped since lib/stripe/connect.ts
      // and no public surface had ever said a client can pay an invoice.
      // Standard Connect with DIRECT charges: no application fee, no
      // on_behalf_of, no transfer_data — the money never touches AMG's
      // account and we hold the acct_… id rather than any key of theirs.
      // The refund limitation is lib/stripe/connect-payments.ts's own
      // "WHAT THIS MODULE DELIBERATELY DOES NOT DO" paragraph and stays in.
      q: "How do clients actually pay me?",
      a: "You connect your own Stripe account, on any plan, and your invoices go out with a card or bank payment link on them. The money settles into your Stripe account rather than ours, and we never hold a key to it. When a payment clears it records itself against the invoice on its own, and a bank debit that is still settling says so rather than going quiet. Refunds and disputes you handle in Stripe and then correct here yourself, because reversing money automatically is a larger claim than recording it.",
    },
    {
      q: "I subscribed when there was one plan. What changes for me?",
      a: `Nothing you didn't ask for. Existing accounts keep their ${TIER_PRICE_COPY.solo.monthly} price: the ladder is additive, and nobody is migrated or asked to choose again. If ${BRAND.name}'s newer business surfaces are worth it to you, upgrading is there; if not, ignore this page.`,
    },
    {
      q: "Do the higher plans decide whether I'm current or legal to fly?",
      a: "No plan does, and none will ever present itself that way. The product tracks dates you entered from your own documents so you can see what's coming due. Currency and airworthiness decisions remain yours.",
    },
    // LAST, and deliberately so: this page's heading promises to answer
    // what a reader needs "before you enter a card", and the honest end of
    // that promise is a way to ask the question this list did not happen to
    // cover. There is no trial to fall back on, so without it the only way
    // to resolve a doubt is to pay and find out.
    {
      q: "What if my question isn't here?",
      a: `Email ${BRAND.supportEmail} and a person will answer.`,
    },
  ];
}
