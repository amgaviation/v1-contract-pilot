import NextLink from "next/link";
import { LCard, LPill } from "@/components/ledger";
import { describeResult } from "@/lib/currency/describe";
import type { CurrencyResult } from "@/lib/currency/types";
import {
  CURRENCY_CARD_TITLES,
  STATUS_BADGE_COLOR,
  countedEntrySummary,
  formatCurrencyDate,
} from "./presentation";

/**
 * Status → LPill tone. STATUS_BADGE_COLOR (presentation.ts) still speaks
 * Radix Badge's vocabulary (green/red/amber) because it is one of the
 * things that module documents itself as owning; this is the one
 * translation point this card needs on top of it, the same shape as
 * invoices/page.tsx's own statusToPillTone.
 */
const BADGE_COLOR_TO_TONE: Record<"green" | "red" | "amber", "good" | "crit" | "warn"> = {
  green: "good",
  red: "crit",
  amber: "warn",
};

/**
 * One currency card. docs/CURRENCY-SPEC.md §6 fixes what renders and in
 * what order, "with no exceptions and no collapsed variant":
 *
 *   1. The state, phrased as an estimate — describe.ts's headline,
 *      verbatim, in a colour-coded badge.
 *   2. The limiting item and its date — describe.ts's sentence, verbatim.
 *   3. The arithmetic, EXPANDED — window, entries counted, rule applied,
 *      plus the engine's own assumptions[] and notes[] sentences, then
 *      the counted entries themselves as links into the logbook so a
 *      pilot can audit every number back to the row it came from.
 *   4. The reg citation with the eCFR link and the retrieval date of the
 *      text the rule was built from.
 *
 * For insufficient_data the remedies render between 3 and 4: each names
 * WHICH field is missing and links WHERE to enter it — "not enough
 * information" with no remedy trains a pilot to ignore the panel.
 *
 * Every sentence of currency prose here comes from lib/currency/describe.ts
 * or the rule modules' own notes/assumptions, rendered verbatim. This
 * component adds layout, the type's display title (presentation.ts), and
 * links — it words no claims of its own.
 */
export default function CurrencyCard({ result }: { result: CurrencyResult }) {
  const described = describeResult(result);
  const heading = CURRENCY_CARD_TITLES[result.currencyType];

  // displayDate is the one date on a card the engine did NOT compute:
  // medical's pilot-entered expiry (61.23(d) is never computed), or a
  // flight-review completion date that needs correcting. Labelled for
  // what it is so it can never read as a verdict.
  const displayDateLabel =
    result.currencyType === "medical" ? "Expiry date you entered" : "Date on file";
  const displayDate = formatCurrencyDate(result.displayDate);

  return (
    <LCard className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-60 flex-1 flex-col gap-1">
          <p className="text-body font-medium text-ink">{heading.title}</p>
          <p className="text-caption text-ink-3">{heading.subtitle}</p>
        </div>
        <LPill tone={BADGE_COLOR_TO_TONE[STATUS_BADGE_COLOR[result.status]]}>
          {described.headline}
        </LPill>
      </div>

      <p className="text-body-s font-medium text-ink">{described.limitingItem}</p>

      {displayDate ? (
        <p className="tnum-l text-body-s text-ink">{`${displayDateLabel}: ${displayDate}`}</p>
      ) : null}

      {/* Item 3 — the arithmetic, expanded, never collapsed. */}
      <div className="flex flex-col gap-1">
        {described.arithmetic.map((line, i) => (
          <p key={i} className="text-caption text-ink-3">
            {line}
          </p>
        ))}
      </div>

      {/* Counted-entries transparency: the exact logbook rows that fed
          this card, each linked, so the pilot can hand-check the
          arithmetic against their own record. */}
      {result.counted.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-caption font-medium text-ink">Entries counted</p>
          {result.counted.map((entry) => (
            <NextLink
              key={entry.entryId}
              href={`/logbook/${entry.entryId}`}
              className="tnum-l text-caption text-accent hover:underline"
            >
              {`${formatCurrencyDate(entry.entryDate) ?? entry.entryDate}: ${countedEntrySummary(entry)}`}
            </NextLink>
          ))}
        </div>
      ) : null}

      {/* insufficient_data as a first-class, actionable state: which
          fact is missing, and a link to the screen where it's entered.
          Labels and hrefs are describe.ts's, verbatim. */}
      {described.remedies.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-caption font-medium text-ink">
            What&rsquo;s missing, and where to record it
          </p>
          {described.remedies.map((remedy) => (
            <NextLink
              key={remedy.missing}
              href={remedy.href}
              className="text-caption text-accent hover:underline"
            >
              {remedy.label}
            </NextLink>
          ))}
        </div>
      ) : null}

      {/* Item 4 — the citation, with the issue date of the text the
          rule was built from and when it was retrieved. The eCFR is the
          authority; this engine is a reading of it on a stated date. */}
      <p className="text-caption text-ink-3">
        <a
          href={described.citation.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          {described.citation.section}
        </a>
        {`. Built from the eCFR text at issue date ${
          formatCurrencyDate(described.citation.issueDate) ?? described.citation.issueDate
        }, retrieved ${
          formatCurrencyDate(described.citation.retrievedOn) ?? described.citation.retrievedOn
        }.`}
      </p>
    </LCard>
  );
}
