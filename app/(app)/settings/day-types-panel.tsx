import { Flex, Heading, Text } from "@/components/ui";
import EmptyState from "@/components/ui/empty-state";
import type { Database } from "@/lib/supabase/database.types";
import DayTypeRow from "./day-type-row";
import AddDayTypeForm from "./add-day-type-form";

type DayTypeRowValue = Database["pilot"]["Tables"]["day_types"]["Row"];

export default function DayTypesPanel({
  dayTypes,
  canEdit,
}: {
  dayTypes: DayTypeRowValue[];
  canEdit: boolean;
}) {
  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="1">
        <Heading as="h3" size="4">Day types</Heading>
      </Flex>

      <Flex direction="column" gap="3">
        {/* Through EmptyState like every list screen in the product —
            heading in the outline, one sentence, and the form that fixes
            it sits directly below. The read's failure is handled by
            settings/page.tsx's own card, so nothing here is a failed
            read wearing an empty state's clothes. */}
        {dayTypes.length === 0 ? (
          <EmptyState title="No day types yet">
            A day type is what one day of work is called on a trip — flight day,
            travel day, standby — and how it bills. Add the ones you use below and
            they become the picker on every trip&rsquo;s day grid.
          </EmptyState>
        ) : (
          dayTypes.map((dayType) => (
            <DayTypeRow key={dayType.id} dayType={dayType} canEdit={canEdit} />
          ))
        )}
      </Flex>

      {canEdit ? (
        <AddDayTypeForm />
      ) : (
        <Text size="1" color="gray">
          Only the account owner can add or change day types.
        </Text>
      )}
    </Flex>
  );
}
