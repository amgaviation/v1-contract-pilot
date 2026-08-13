import { Card, Flex, Grid, Skeleton, Table } from "@/components/ui";

/**
 * LOADING SKELETONS — structure while the data is in flight, instead of a
 * spinner in an empty room.
 *
 * WHY THIS EXISTS. Every one of this product's 40-odd `loading.tsx` files
 * was the same four-line re-export of one centred spinner card. That is
 * fine on a fast connection and actively bad on the connection this
 * product is actually used on: a pilot on FBO wifi hits Overview, gets a
 * blank card with a spinner, navigates to Invoices, gets the identical
 * blank card with the identical spinner, and has no signal that anything
 * about the page changed — the app reads as one perpetually-loading screen
 * rather than as several screens loading. A skeleton in the shape of what
 * is coming fixes that for free: the eye lands on the row rhythm and the
 * column count before the bytes arrive, so the real content does not
 * re-teach the layout every time.
 *
 * BUILT ON RADIX'S OWN `Skeleton`, not on a hand-rolled shimmer.
 * @radix-ui/themes 3.3.0 ships it; it takes the theme's radius and colour
 * scale, respects prefers-reduced-motion, and — the part that matters —
 * `loading={false}` makes it render its children unchanged, so a future
 * inline use can wrap real content without a branch. Re-exported through
 * @/components/ui like everything else.
 *
 * ACCESSIBILITY. A skeleton is decoration: it says nothing to a screen
 * reader, and a wall of empty boxes announced as content would be worse
 * than silence. So every block here is `aria-hidden`, and the one
 * announcement lives in LoadingPanel (app/(app)/loading-panel.tsx), which
 * keeps its `role="status"` + `aria-live` line and composes these shapes
 * underneath it. The sighted and non-sighted halves of the same statement.
 *
 * NO NEW VISUAL VALUES. Sizes are Radix space/size tokens via props; the
 * two width fractions below are layout percentages, not colours, radii or
 * type — nothing here reaches around the theme.
 */

/**
 * One line of placeholder text at a given width. Radix's Skeleton takes
 * `width`/`height` directly (skeleton.props.d.ts — both are responsive
 * string props writing --width/--height), so an empty Skeleton with
 * explicit dimensions is the whole primitive; no wrapper needed.
 * `--space-4` is a theme token, so the bar's height moves with the
 * tenant's density setting rather than being pinned in pixels.
 */
function Line({ width }: { width: string }) {
  return <Skeleton width={width} height="var(--space-4)" />;
}

/**
 * A generic panel: a title line, two body lines. The default shape, used
 * wherever a screen is a form or a detail page rather than a list.
 */
export function PanelSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <Flex direction="column" gap="3" aria-hidden>
      <Line width="30%" />
      {Array.from({ length: Math.max(1, lines - 1) }, (_, i) => (
        // Alternating widths, because a stack of identical bars reads as a
        // loading bar rather than as text.
        <Line key={i} width={i % 2 === 0 ? "90%" : "70%"} />
      ))}
    </Flex>
  );
}

/**
 * The Overview money row: TWO LABELLED GROUPS of cards, not one flat row
 * of four.
 *
 * The layout constants are exported and consumed by the real row
 * (app/(app)/overview/page.tsx) as well as by this skeleton, because
 * silent drift between the two is the one failure mode a skeleton has.
 * It had already happened: the row was rebuilt into two `<section>`s
 * ("Owed to you" / "This calendar year"), each a group-label line over an
 * inner two-up grid, and each card gained a fourth line — while this
 * still painted the old `{initial:1, sm:2, lg:4}` grid of three-line
 * cards. At a 900px window that is two cards across becoming two stacked
 * labelled groups, and everything below the row jumping down on
 * hydration, on the product's most-visited screen.
 */
export const STAT_ROW_LAYOUT = {
  /** The outer group grid — one group per column from `lg` up. */
  groups: { initial: "1", lg: "2" },
  groupGap: "5",
  /** The card grid inside one group. */
  cards: { initial: "1", sm: "2" },
  cardGap: "4",
  /** How many cards one group holds. */
  cardsPerGroup: 2,
} as const;

export function StatRowSkeleton({
  groups = 2,
  cardsPerGroup = STAT_ROW_LAYOUT.cardsPerGroup,
}: {
  groups?: number;
  cardsPerGroup?: number;
}) {
  return (
    <Grid columns={STAT_ROW_LAYOUT.groups} gap={STAT_ROW_LAYOUT.groupGap} aria-hidden>
      {Array.from({ length: groups }, (_, g) => (
        <Flex key={g} direction="column" gap="2">
          {/* The group label ("Owed to you" / "This calendar year") is a
              real line of text in the real row, so it is a real line here. */}
          <Line width="35%" />
          <Grid columns={STAT_ROW_LAYOUT.cards} gap={STAT_ROW_LAYOUT.cardGap}>
            {Array.from({ length: cardsPerGroup }, (_, i) => (
              <Card key={i}>
                <Flex direction="column" gap="1">
                  <Line width="55%" />
                  {/* Taller than a text line: this is where the big money
                      figure lands, and a KPI card that grows two steps
                      when the data arrives is exactly the layout shift a
                      skeleton exists to prevent. */}
                  <Skeleton width="70%" height="var(--space-6)" />
                  <Line width="45%" />
                  {/* The hint line every card gained with the regrouping. */}
                  <Line width="80%" />
                </Flex>
              </Card>
            ))}
          </Grid>
        </Flex>
      ))}
    </Grid>
  );
}

/**
 * A list screen: a real `Table` with header cells and empty rows, so the
 * column count and row rhythm are established before the first byte of
 * data. A plain stack of bars would not do that — the columns are the
 * thing a pilot is orienting on.
 */
export function TableSkeleton({
  columns = 5,
  rows = 6,
}: {
  columns?: number;
  rows?: number;
}) {
  return (
    <Table.Root variant="ghost" aria-hidden>
      <Table.Header>
        <Table.Row>
          {Array.from({ length: columns }, (_, i) => (
            <Table.ColumnHeaderCell key={i}>
              <Line width="70%" />
            </Table.ColumnHeaderCell>
          ))}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {Array.from({ length: rows }, (_, r) => (
          <Table.Row key={r}>
            {Array.from({ length: columns }, (_, c) => (
              <Table.Cell key={c}>
                {/* The first column is the record's name and is wider in
                    every one of this product's tables; the rest are dates,
                    amounts and badges. */}
                <Line width={c === 0 ? "80%" : "50%"} />
              </Table.Cell>
            ))}
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
