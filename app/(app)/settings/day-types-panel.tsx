import { LCard, LEmpty } from "@/components/ledger";
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
    <div className="flex flex-col gap-4">
      <h3 className="text-h3 font-semibold text-ink">Day types</h3>

      <div className="flex flex-col gap-3">
        {/* Through LEmpty like every list screen on Ledger — heading in the
            outline, one sentence, and the form that fixes it sits directly
            below. The read's failure is handled by settings/page.tsx's own
            card, so nothing here is a failed read wearing an empty state's
            clothes. */}
        {dayTypes.length === 0 ? (
          <LCard>
            <LEmpty title="No day types yet">
              A day type names one day of work on a trip (flight, travel,
              standby) and sets how it bills. Add yours below and they become
              the day grid&rsquo;s picker.
            </LEmpty>
          </LCard>
        ) : (
          dayTypes.map((dayType) => (
            <DayTypeRow key={dayType.id} dayType={dayType} canEdit={canEdit} />
          ))
        )}
      </div>

      {canEdit ? (
        <AddDayTypeForm />
      ) : (
        <p className="text-body-s text-ink-3">
          Only the account owner can add or change day types.
        </p>
      )}
    </div>
  );
}
