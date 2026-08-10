import { Container, Flex, Spinner, Text } from "@/components/ui";

/**
 * Only app/(marketing)/page.tsx actually awaits anything (the signed-in
 * redirect check) — /pricing, /terms and /privacy are static and resolve
 * before this could ever paint. It lives at the group root rather than
 * nested under page.tsx alone because a route segment's loading.tsx has no
 * narrower target than "this page slot," and there is only the one page
 * here that needs it.
 */
export default function Loading() {
  return (
    <Container size="4" px="4" py="9">
      <Flex align="center" justify="center" gap="2" role="status" aria-live="polite">
        <Spinner aria-hidden />
        <Text size="2" color="gray">
          Loading…
        </Text>
      </Flex>
    </Container>
  );
}
