import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
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
    <MDBox>
      <MDBox mb={2} lineHeight={1.25}>
        <MDTypography variant="h6">Day types</MDTypography>
        <MDTypography variant="button" color="text" fontWeight="regular">
          What a day of work is called on your trips, and how it bills.
          Rename any of these freely. Archive one you no longer use instead
          of deleting it — trips already recorded still need it to render.
        </MDTypography>
      </MDBox>

      <MDBox display="flex" flexDirection="column" gap={2} mb={3}>
        {dayTypes.length === 0 ? (
          <MDTypography variant="button" color="text" fontWeight="regular">
            No day types yet.
          </MDTypography>
        ) : (
          dayTypes.map((dayType) => (
            <DayTypeRow key={dayType.id} dayType={dayType} canEdit={canEdit} />
          ))
        )}
      </MDBox>

      {canEdit ? (
        <AddDayTypeForm />
      ) : (
        <MDTypography variant="caption" color="text">
          Only the account owner can add or change day types.
        </MDTypography>
      )}
    </MDBox>
  );
}
