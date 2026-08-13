import type { ReactNode } from "react";
import { Box, Flex, Heading, Text } from "@/components/ui";

/**
 * THE EMPTY STATE, once.
 *
 * Eleven screens in this product had already worked out what a good empty
 * state is — centred column, a heading, one sentence saying what the screen
 * is FOR, and a primary button that creates the first record — and each had
 * written it out by hand. Copy-paste is not the problem in itself; the
 * problem is that eleven copies drift. They already had: some used
 * `Heading size="4"`, some a `Text size="4" weight="bold"`; some put `mt="2"`
 * on the button and some didn't; `py` was 5 on the overview panels and 6 on
 * the list screens. None of that was a decision anyone made.
 *
 * So the SHAPE lives here and the WORDS stay at the call site. That split
 * is the whole design: an empty state that says "No records." is useless
 * whatever it looks like, and this component cannot supply a good sentence
 * for a screen it knows nothing about. It therefore has no default title,
 * no default body and no default action — a call site must decide all
 * three, which is exactly the friction that stops the next screen from
 * shipping "No X." and calling it done.
 *
 * THE FOUR CASES THIS HAS TO COVER, and they are genuinely different:
 *
 *   nothing yet      "No trips yet" + what a trip is for + Log your first trip
 *   filtered out     "Nothing past due" + how many exist in total + Show all
 *   off the end      "Nothing on this page" + where the last page is + Back
 *   couldn't read    NOT this component's job — see the note below.
 *
 * A FAILED READ IS NOT AN EMPTY STATE and must never render through here.
 * This product's standing rule (app/(app)/overview/page.tsx states it at
 * length) is that "we couldn't load your trips" and "you have no trips" are
 * different claims, and printing the second for the first invites a pilot
 * to re-enter records that already exist. Call sites keep their own Callout
 * for the error branch and reach this component only once the read has
 * succeeded.
 *
 * A server component: no state, no handlers, so screens built on it stay
 * server components.
 */
export default function EmptyState({
  /**
   * A short noun phrase, not a sentence: "No trips yet", "Nothing past
   * due". Rendered as a heading so it lands in the document outline — a
   * pilot navigating a table-heavy screen by heading should find it.
   */
  title,
  /**
   * One sentence about what this screen is for and what the action below
   * will do. Not "there is nothing here" restated.
   */
  children,
  /** The primary control: the thing that creates the first record. */
  action,
  /** An optional second, lower-emphasis route out (import, filters, docs). */
  secondaryAction,
  /**
   * The heading level. Defaults to h3, which is right inside a Card that
   * already sits under the page's h1 and a panel h2. A screen whose empty
   * state IS the panel heading passes "h2".
   */
  as = "h3",
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  as?: "h2" | "h3";
}) {
  return (
    // py="6" and gap="3" — the value the majority of the hand-written
    // copies already used, so adopting this changes nothing visually on
    // the screens that were already right and quietly corrects the ones
    // that weren't. max-width on the sentence keeps a long explanation
    // from running the full width of a wide table.
    <Flex direction="column" align="center" gap="3" py="6" px="3">
      <Heading as={as} size="4" align="center">
        {title}
      </Heading>
      <Box maxWidth="46ch">
        <Text as="p" size="2" color="gray" align="center">
          {children}
        </Text>
      </Box>
      {action || secondaryAction ? (
        <Flex gap="3" mt="1" wrap="wrap" justify="center">
          {action}
          {secondaryAction}
        </Flex>
      ) : null}
    </Flex>
  );
}
