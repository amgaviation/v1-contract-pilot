import NextLink from "next/link";
import { Badge, Card, Flex, Link, Text } from "@/components/ui";
import { describeResult } from "@/lib/currency/describe";
import type { CurrencyResult } from "@/lib/currency/types";
import {
  CURRENCY_CARD_TITLES,
  STATUS_BADGE_COLOR,
  countedEntrySummary,
  formatCurrencyDate,
} from "./presentation";

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
    <Card variant="surface">
      <Flex direction="column" gap="3" p="1">
        <Flex justify="between" align="start" gap="3" wrap="wrap">
          <Flex direction="column" gap="1" flexGrow="1" flexShrink="1" flexBasis="240px">
            <Text size="3" weight="medium" as="div">
              {heading.title}
            </Text>
            <Text size="1" color="gray" as="div">
              {heading.subtitle}
            </Text>
          </Flex>
          <Badge color={STATUS_BADGE_COLOR[result.status]}>{described.headline}</Badge>
        </Flex>

        <Text size="2" weight="medium" as="div">
          {described.limitingItem}
        </Text>

        {displayDate ? (
          <Text size="2" as="div">
            {`${displayDateLabel}: ${displayDate}`}
          </Text>
        ) : null}

        {/* Item 3 — the arithmetic, expanded, never collapsed. */}
        <Flex direction="column" gap="1">
          {described.arithmetic.map((line, i) => (
            <Text key={i} size="1" color="gray" as="div">
              {line}
            </Text>
          ))}
        </Flex>

        {/* Counted-entries transparency: the exact logbook rows that fed
            this card, each linked, so the pilot can hand-check the
            arithmetic against their own record. */}
        {result.counted.length > 0 ? (
          <Flex direction="column" gap="1">
            <Text size="1" weight="medium" as="div">
              Entries counted
            </Text>
            {result.counted.map((entry) => (
              <Text key={entry.entryId} size="1" as="div">
                <Link asChild size="1">
                  <NextLink href={`/logbook/${entry.entryId}`}>
                    {`${formatCurrencyDate(entry.entryDate) ?? entry.entryDate} — ${countedEntrySummary(entry)}`}
                  </NextLink>
                </Link>
              </Text>
            ))}
          </Flex>
        ) : null}

        {/* insufficient_data as a first-class, actionable state: which
            fact is missing, and a link to the screen where it's entered.
            Labels and hrefs are describe.ts's, verbatim. */}
        {described.remedies.length > 0 ? (
          <Flex direction="column" gap="1">
            <Text size="1" weight="medium" as="div">
              What&rsquo;s missing, and where to record it
            </Text>
            {described.remedies.map((remedy) => (
              <Text key={remedy.missing} size="1" as="div">
                <Link asChild size="1">
                  <NextLink href={remedy.href}>{remedy.label}</NextLink>
                </Link>
              </Text>
            ))}
          </Flex>
        ) : null}

        {/* Item 4 — the citation, with the issue date of the text the
            rule was built from and when it was retrieved. The eCFR is the
            authority; this engine is a reading of it on a stated date. */}
        <Text size="1" color="gray" as="div">
          <Link size="1" href={described.citation.url} target="_blank" rel="noopener noreferrer">
            {described.citation.section}
          </Link>
          {` — built from the eCFR text at issue date ${
            formatCurrencyDate(described.citation.issueDate) ?? described.citation.issueDate
          }, retrieved ${
            formatCurrencyDate(described.citation.retrievedOn) ?? described.citation.retrievedOn
          }.`}
        </Text>
      </Flex>
    </Card>
  );
}
