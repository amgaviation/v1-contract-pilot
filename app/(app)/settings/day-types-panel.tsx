import { Flex, Heading, Text } from "@/components/ui";
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
        <Text size="2" color="gray">
          What a day of work is called on your trips, and how it bills. Rename any of these
          freely. Archive one you no longer use instead of deleting it — trips already recorded
          still need it to render.
        </Text>
      </Flex>

      <Flex direction="column" gap="3">
        {dayTypes.length === 0 ? (
          <Text size="2" color="gray">
            No day types yet.
          </Text>
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
