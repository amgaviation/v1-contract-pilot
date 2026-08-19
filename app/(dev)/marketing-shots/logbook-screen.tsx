import NextLink from "next/link";
import { LCard, lButtonClass } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";
import {
  HoursByTypeTable,
  LogbookEntriesTable,
  LogbookTotalsCards,
} from "../../(app)/logbook/panels";
import {
  LOGBOOK_BY_TYPE,
  LOGBOOK_ENTRIES,
  LOGBOOK_ENTRY_COUNT,
  LOGBOOK_TOTALS,
} from "./fixtures";

/**
 * THE LOGBOOK SCREEN, RENDERED FROM ITS REAL COMPONENTS.
 *
 * Extraction, not re-composition — the first of the two options in the
 * harness header. The real screen's card row, hours-by-type table and
 * entries table were welded into app/(app)/logbook/page.tsx beside its
 * reads; they now live in app/(app)/logbook/panels.tsx as props-driven
 * components, and THAT PAGE RENDERS THEM TOO. So a column added here is a
 * column added there, and a screenshot taken from this file cannot show a
 * logbook the product does not have.
 *
 * What stayed in page.tsx is everything a screenshot has no business
 * carrying: the reads, the four distinct empty states, the rule that a
 * failed read may never render as an empty logbook, the filter caption and
 * the pagination.
 *
 * The saved-views bar is not rendered here. It is a client component whose
 * whole surface is a filter form, and an unfiltered career view is the
 * picture worth showing; its absence is a composition choice made in this
 * file, not a difference in the components below.
 *
 * Data is entirely invented — see ./fixtures.ts. One entry per LEG, PIC and
 * SIC in separate columns, simulator time never folded into aircraft time.
 */
export default function LogbookScreen() {
  return (
    <LPageShell
      title="Logbook"
      subtitle={`${LOGBOOK_ENTRY_COUNT.toLocaleString()} entries`}
      action={
        <>
          <a href="/logbook/export" download className={lButtonClass({ variant: "outline" })}>
            Download your logbook (CSV)
          </a>
          <NextLink href="/logbook/drafts" className={lButtonClass({ variant: "outline" })}>
            Trip drafts
          </NextLink>
          <NextLink href="/logbook/import" className={lButtonClass({ variant: "outline" })}>
            Import CSV
          </NextLink>
          <NextLink href="/logbook/new" className={lButtonClass({ variant: "primary" })}>
            Log an entry
          </NextLink>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <LogbookTotalsCards totals={LOGBOOK_TOTALS} />

        <LCard>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-h3 font-semibold">Hours by type</h2>
              <NextLink
                href="/aircraft"
                className={lButtonClass({ variant: "outline" })}
              >
                Your aircraft
              </NextLink>
            </div>
            <HoursByTypeTable rows={LOGBOOK_BY_TYPE} />
          </div>
        </LCard>

        <LCard>
          <LogbookEntriesTable entries={LOGBOOK_ENTRIES} />
        </LCard>
      </div>
    </LPageShell>
  );
}
