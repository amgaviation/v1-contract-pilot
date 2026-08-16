import NextLink from "next/link";
import { LAlert, LCard, lButtonClass } from "@/components/ledger";

import { createClient } from "@/lib/supabase/server";
import { rowsOf } from "@/lib/supabase/rows";
import { formatCents } from "@/lib/format";
import { clientCostTotals } from "@/lib/expense-client";
import { idChunks } from "@/lib/id-chunks";

/**
 * WHAT THIS CLIENT HAS COST, both ways a cost can reach them.
 *
 * The page already answers "what do they owe me". It could not answer
 * "what have they cost me", because until 20260815130000 an expense could
 * only reach a client through a trip -- so every cost that never went
 * through one (recurrent training or indoc a client required before they
 * would roster you, a headset adapter for one owner's panel, the parking on
 * a day that cancelled before it became a trip) was invisible to this
 * question.
 *
 * Both paths are counted, per lib/expense-client.ts's single reading rule:
 * an expense attributed DIRECTLY to this client, and an expense sitting on
 * one of this client's trips. Counting only one would understate the
 * figure, which is the direction that actually misleads.
 *
 * A server component with its own reads (the PacketPanel/PaymentInsightPanel
 * arrangement), so the client page's own query block stays small.
 */

// Same cap discipline as every list read in this app: 1000, detected by
// exact equality, never a larger number the server's own clamp would make
// unreachable.
const COST_LIMIT = 1000;

type CostExpenseRow = {
  id: string;
  amount_cents: number;
  treatment: string;
  trip_id: string | null;
  client_id: string | null;
};

export default async function CostPanel({
  clientId,
  clientName,
  archived,
}: {
  clientId: string;
  clientName: string;
  /**
   * Archived means "don't offer this for new work". The Record-a-cost
   * action is withheld rather than left to fail politely: /expenses/new
   * validates ?client= against the pickable clients, which deliberately
   * exclude archived ones, so the form would open with nothing selected
   * and a pilot who did not notice would file the cost unattributed --
   * the exact opposite of what the button offered.
   */
  archived: boolean;
}) {
  const supabase = await createClient();

  // This client's trips first, because the trip-attached half of the answer
  // cannot be asked for without them. Ids only.
  const tripsResult = rowsOf<{ id: string }>(
    await supabase.from("trips").select("id").eq("client_id", clientId).limit(COST_LIMIT)
  );

  if (!tripsResult.ok) return <FailedState />;
  const tripIds = tripsResult.rows.map((trip) => trip.id);

  // Two reads rather than one `.or()` string: building an `or=(...)` filter
  // by string concatenation around a list of unknown length is how a query
  // silently stops matching. Rows appearing in both are deduplicated by id.
  //
  // The trip-attached half is CHUNKED (lib/id-chunks.ts). `.in()` puts every
  // trip uuid in the GET query string, so a pilot with a thousand trips for
  // one client produced a ~39 KB URL: rejected by a proxy long before
  // Postgres saw it, which turned a figure that was merely partial into the
  // panel's hard-failure state.
  const [directResult, ...tripChunkResults] = await Promise.all([
    supabase
      .from("expenses")
      .select("id, amount_cents, treatment, trip_id, client_id")
      .eq("client_id", clientId)
      .limit(COST_LIMIT),
    ...idChunks(tripIds).map((chunk) =>
      supabase
        .from("expenses")
        .select("id, amount_cents, treatment, trip_id, client_id")
        .in("trip_id", chunk)
        .limit(COST_LIMIT)
    ),
  ]);

  const direct = rowsOf<CostExpenseRow>(directResult);
  if (!direct.ok) return <FailedState />;
  const viaTripChunks = tripChunkResults.map((result) => rowsOf<CostExpenseRow>(result));
  if (viaTripChunks.some((chunk) => !chunk.ok)) return <FailedState />;
  const viaTripRows = viaTripChunks.flatMap((chunk) => (chunk.ok ? chunk.rows : []));

  const byId = new Map<string, CostExpenseRow>();
  for (const row of [...direct.rows, ...viaTripRows]) byId.set(row.id, row);
  const expenses = [...byId.values()];

  // Every row here already belongs to this client by construction, but the
  // totals still go through the shared rule rather than a local reduce, so
  // this figure and the /expenses list's filtered figure are computed by
  // the same code and cannot drift.
  const tripClientIds = new Map(tripIds.map((id) => [id, clientId as string | null]));
  const totals = clientCostTotals(expenses, tripClientIds, clientId);

  // Any single read hitting the cap means the total is partial. Checked per
  // chunk, not on the merged list, because the cap applies per request.
  const truncated =
    direct.rows.length === COST_LIMIT ||
    viaTripChunks.some((chunk) => chunk.ok && chunk.rows.length === COST_LIMIT) ||
    tripsResult.rows.length === COST_LIMIT;

  return (
    <LCard>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <div className="text-h3 font-semibold">Costs</div>
        <div className="flex flex-wrap gap-2">
          <NextLink href={`/expenses?client=${clientId}`} className={lButtonClass({ variant: "outline", size: "sm" })}>
            See every cost
          </NextLink>
          {archived ? null : (
            <NextLink href={`/expenses/new?client=${clientId}`} className={lButtonClass({ variant: "outline", size: "sm" })}>
              Record a cost
            </NextLink>
          )}
        </div>
      </div>
      <p className="mb-3 text-body-s text-ink-3">
        {totals.count === 0
          ? `Nothing recorded against ${clientName} yet, on a trip or off one.`
          : `${totals.count} expense${totals.count === 1 ? "" : "s"}, on their trips and attributed to them directly.`}
      </p>

      {totals.count > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Figure label="Total" cents={totals.totalCents} emphasis />
          <Figure label="To rebill" cents={totals.rebillCents} />
          <Figure label="Deducted" cents={totals.deductCents} />
          <Figure label="Unfiled" cents={totals.unassignedCents} />
        </div>
      ) : null}

      {truncated ? (
        <LAlert tone="warn" className="mt-3 flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-warn" />
          <span>
            {`These figures may be partial. More than ${COST_LIMIT} records were involved and only the first ${COST_LIMIT} were totaled.`}
          </span>
        </LAlert>
      ) : null}
    </LCard>
  );
}

function Figure({
  label,
  cents,
  emphasis,
}: {
  label: string;
  cents: number;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-ink-3">{label}</span>
      <span
        className={
          emphasis
            ? "tnum-l text-figure font-bold tracking-tight"
            : "tnum-l text-body font-medium"
        }
      >
        {formatCents(cents)}
      </span>
    </div>
  );
}

function FailedState() {
  return (
    <LCard>
      <LAlert tone="crit" className="flex items-start gap-2">
        <WarningIcon className="mt-0.5 shrink-0 text-crit" />
        <span>
          Couldn&rsquo;t load this client&rsquo;s costs. The figures are
          unavailable rather than zero. Try reloading the page.
        </span>
      </LAlert>
    </LCard>
  );
}

/* ── Inline icon ───────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. Same shape as invoices/page.tsx's own WarningIcon. */
function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 2 14.25 13H1.75Z" />
      <path d="M8 6.25v3" />
      <circle cx="8" cy="11.25" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
