import { LCard, LSkeleton } from "@/components/ledger";

/**
 * Segment-level fallback, ported to Ledger. Same API and same reasoning as
 * the INSTRUMENT version this replaces (every `loading.tsx` in the (app)
 * route group is a four-line re-export of this one file, so the whole
 * product's loading experience is decided here) — only the skin changes.
 *
 * THE ACCESSIBLE HALF IS UNCHANGED. `role="status"` + `aria-live="polite"`
 * on a real sentence is what reaches a screen reader; every `LSkeleton`
 * block below is `aria-hidden` on its own (see components/ledger/index.tsx)
 * so it is never announced as a wall of empty boxes.
 */
export type LoadingShape = "panel" | "table" | "dashboard";

function Line({ width }: { width: string }) {
  return <LSkeleton className="h-4" style={{ width }} />;
}

function PanelBody({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-3">
      <Line width="30%" />
      {Array.from({ length: Math.max(1, lines - 1) }, (_, i) => (
        <Line key={i} width={i % 2 === 0 ? "90%" : "70%"} />
      ))}
    </div>
  );
}

function StatRowBody({ groups = 2, cardsPerGroup = 2 }: { groups?: number; cardsPerGroup?: number }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {Array.from({ length: groups }, (_, g) => (
        <div key={g} className="flex flex-col gap-2">
          <Line width="35%" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: cardsPerGroup }, (_, i) => (
              <LCard key={i} className="p-4">
                <div className="flex flex-col gap-1">
                  <Line width="55%" />
                  <LSkeleton className="h-6" style={{ width: "70%" }} />
                  <Line width="45%" />
                  <Line width="80%" />
                </div>
              </LCard>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TableBody({ columns = 5, rows = 6 }: { columns?: number; rows?: number }) {
  return (
    <table className="w-full border-collapse text-body-s">
      <thead>
        <tr>
          {Array.from({ length: columns }, (_, i) => (
            <th key={i} className="border-b border-hair px-3 py-2 text-left first:pl-0 last:pr-0">
              <Line width="70%" />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r}>
            {Array.from({ length: columns }, (_, c) => (
              <td key={c} className="border-b border-hair px-3 py-2.5 first:pl-0 last:pr-0">
                <Line width={c === 0 ? "80%" : "50%"} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

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
    <div className="flex flex-col gap-4">
      {/* The announcement. Visible too — a skeleton alone leaves a pilot
          on a slow link guessing whether the page is loading or broken.
          Every LSkeleton block below is aria-hidden on its own (see
          components/ledger/index.tsx), so this stays the only thing
          announced. */}
      <p className="text-body-s text-ink-2" role="status" aria-live="polite">
        Loading {label}…
      </p>

      {shape === "dashboard" ? (
        <>
          <StatRowBody />
          <LCard className="overflow-x-auto p-0">
            <div className="p-4">
              <TableBody columns={7} rows={3} />
            </div>
          </LCard>
          <LCard className="p-4">
            <PanelBody lines={5} />
          </LCard>
        </>
      ) : shape === "table" ? (
        <LCard className="overflow-x-auto p-4">
          <TableBody columns={columns ?? 5} />
        </LCard>
      ) : (
        <LCard className="p-4">
          <PanelBody lines={4} />
        </LCard>
      )}
    </div>
  );
}
