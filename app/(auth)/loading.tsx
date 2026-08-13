import { Flex, Spinner, Text } from "@/components/ui";

/**
 * The auth group's route-transition state. /welcome awaits the live Stripe
 * price lookup and every page here awaits a session check, so a slow
 * network used to leave the form column blank while the navy panel was
 * already painted — the split makes an empty right-hand column obvious in
 * a way the old centered card never was.
 *
 * It renders inside ../layout.tsx's form column, so it needs no chrome of
 * its own: the brand panel is already on screen beside it.
 */
export default function Loading() {
  return (
    <Flex
      align="center"
      justify="center"
      gap="2"
      py="9"
      role="status"
      aria-live="polite"
    >
      <Spinner aria-hidden />
      <Text size="2" color="gray">
        Loading…
      </Text>
    </Flex>
  );
}
