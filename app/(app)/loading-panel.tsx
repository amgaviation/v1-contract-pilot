import { Card, Flex, Text } from "@/components/ui";
import {
  PanelSkeleton,
  StatRowSkeleton,
  TableSkeleton,
} from "@/components/ui/skeletons";

/**
 * Segment-level fallback. Each of these screens blocks on a round trip to
 * Supabase before it can render anything — /trips/[id] on six queries — so
 * without a `loading.tsx` the pilot gets a dead screen with no signal that
 * anything is happening.
 *
 * WHAT CHANGED, AND WHY IT IS ONE COMPONENT RATHER THAN FORTY. Every
 * `loading.tsx` in this route group is a four-line re-export of this file,
 * which means the whole product's loading experience is decided here. It
 * used to be a spinner and a line of text — identical on every screen, so
 * navigating the app read as one perpetual loading state rather than as
 * several screens each arriving. It now renders a SKELETON in roughly the
 * shape of what is coming, and the `shape` prop is how a screen says which
 * shape that is. Every existing call site keeps working unchanged and gets
 * the generic panel; the eight list-and-dashboard screens that carry the
 * most structure pass a shape and get a matching one.
 *
 * THE ACCESSIBLE HALF IS UNCHANGED AND STILL LIVES HERE, once.
 * `role="status"` + `aria-live="polite"` on a real sentence is what
 * actually reaches a screen reader; the skeleton is the sighted half of
 * the same statement and is `aria-hidden` inside components/ui/skeletons
 * so it is not announced as a wall of empty boxes. The spinner is gone,
 * not replaced: a spinner next to a skeleton is two loading indicators for
 * one wait.
 */
export type LoadingShape = "panel" | "table" | "dashboard";

export default function LoadingPanel({
  label,
  shape = "panel",
  /** Column count for `shape="table"`. Match the real table's. */
  columns,
}: {
  label: string;
  shape?: LoadingShape;
  columns?: number;
}) {
  return (
    <Flex direction="column" gap="4">
      {/* The announcement. Visible too — a skeleton alone leaves a pilot
          on a slow link guessing whether the page is loading or broken. */}
      <Text size="2" color="gray" role="status" aria-live="polite">
        Loading {label}…
      </Text>

      {shape === "dashboard" ? (
        <>
          <StatRowSkeleton />
          <Card>
            <PanelSkeleton lines={5} />
          </Card>
        </>
      ) : shape === "table" ? (
        <Card>
          <TableSkeleton columns={columns ?? 5} />
        </Card>
      ) : (
        <Card>
          <PanelSkeleton lines={4} />
        </Card>
      )}
    </Flex>
  );
}
