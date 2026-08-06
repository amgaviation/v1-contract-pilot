import { Card, Flex, Heading, Text } from "@radix-ui/themes";
import type { Database } from "@/lib/supabase/database.types";
import RateOverrideRow from "./rate-override-row";

type DayTypeRow = Database["pilot"]["Tables"]["day_types"]["Row"];
type ClientRateRow = Database["pilot"]["Tables"]["client_rates"]["Row"];

export default function RateOverridesPanel({
  clientId,
  dayTypes,
  overrides,
}: {
  clientId: string;
  /** Every day type, active or archived — see the filtering note below. */
  dayTypes: DayTypeRow[];
  overrides: ClientRateRow[];
}) {
  const overrideByDayType = new Map(overrides.map((o) => [o.day_type_id, o.rate_cents]));

  // F10: an archived type is dropped from the picker UNLESS this client
  // still has an override on it — otherwise saving an override, then
  // archiving the day type it's for, made the override invisible here
  // while it was still a live row in client_rates (visible only by
  // deleting and re-creating it, which a pilot has no reason to try).
  const visibleDayTypes = dayTypes
    .filter((dt) => !dt.archived_at || overrideByDayType.has(dt.id))
    .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));

  return (
    <Card size="3">
      <Flex direction="column" gap="1" mb="3">
        <Heading as="h3" size="4">Rate overrides</Heading>
        <Text size="2" color="gray">
          What this client pays per day type, if different from your usual
          rate. Blank uses the day type&rsquo;s own default. A change here
          affects days captured from now on — it never re-prices work
          already recorded.
        </Text>
      </Flex>

      {visibleDayTypes.length === 0 ? (
        <Text size="2" color="gray">
          No active day types yet. Add some under Settings → Day types.
        </Text>
      ) : (
        <Flex direction="column">
          {visibleDayTypes.map((dayType) => (
            <RateOverrideRow
              key={dayType.id}
              clientId={clientId}
              dayTypeId={dayType.id}
              label={dayType.label}
              archived={Boolean(dayType.archived_at)}
              defaultRateCents={dayType.default_rate_cents}
              overrideRateCents={overrideByDayType.get(dayType.id) ?? null}
            />
          ))}
        </Flex>
      )}
    </Card>
  );
}
