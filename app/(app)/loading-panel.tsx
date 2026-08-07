import { Card, Flex, Spinner, Text } from "@/components/ui";

/**
 * Segment-level fallback. Each of these screens blocks on a round trip to
 * Supabase before it can render anything — /trips/[id] on six queries — so
 * without a `loading.tsx` the pilot gets a dead screen with no signal that
 * anything is happening.
 *
 * role="status" + aria-live is what makes this reach a screen reader; the
 * spinner is the sighted half of the same statement. aria-hidden on the
 * spinner keeps it from being announced twice.
 */
export default function LoadingPanel({ label }: { label: string }) {
  return (
    <Card>
      <Flex align="center" gap="2" p="2" role="status" aria-live="polite">
        <Spinner aria-hidden />
        <Text size="2" color="gray">
          Loading {label}…
        </Text>
      </Flex>
    </Card>
  );
}
