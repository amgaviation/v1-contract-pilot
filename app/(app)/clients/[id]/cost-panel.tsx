import NextLink from "next/link";
import { Button, Callout, Card, Flex, Grid, Text } from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { rowsOf } from "@/lib/supabase/rows";
import { formatCents } from "@/lib/format";
import { clientCostTotals } from "@/lib/expense-client";

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
}: {
  clientId: string;
  clientName: string;
}) {
  const supabase = await createClient();

  // This client's trips first, because the trip-attached half of the answer
  // cannot be asked for without them. Ids only.
  const tripsResult = rowsOf<{ id: string }>(
    await supabase.from("trips").select("id").eq("client_id", clientId).limit(COST_LIMIT)
  );

  if (!tripsResult.ok) return <FailedState />;
  const tripIds = tripsResult.rows.map((trip) => trip.id);

  // Two reads rather than one `.or()` string: the trip-id list goes into a
  // URL, and building an `or=(...)` filter by string concatenation around
  // a list of unknown length is how a query silently stops matching. Rows
  // appearing in both are deduplicated by id below.
  const [directResult, viaTripResult] = await Promise.all([
    supabase
      .from("expenses")
      .select("id, amount_cents, treatment, trip_id, client_id")
      .eq("client_id", clientId)
      .limit(COST_LIMIT),
    tripIds.length > 0
      ? supabase
          .from("expenses")
          .select("id, amount_cents, treatment, trip_id, client_id")
          .in("trip_id", tripIds)
          .limit(COST_LIMIT)
      : Promise.resolve({ data: [] as CostExpenseRow[], error: null }),
  ]);

  const direct = rowsOf<CostExpenseRow>(directResult);
  const viaTrip = rowsOf<CostExpenseRow>(viaTripResult);
  if (!direct.ok || !viaTrip.ok) return <FailedState />;

  const byId = new Map<string, CostExpenseRow>();
  for (const row of [...direct.rows, ...viaTrip.rows]) byId.set(row.id, row);
  const expenses = [...byId.values()];

  // Every row here already belongs to this client by construction, but the
  // totals still go through the shared rule rather than a local reduce, so
  // this figure and the /expenses list's filtered figure are computed by
  // the same code and cannot drift.
  const tripClientIds = new Map(tripIds.map((id) => [id, clientId as string | null]));
  const totals = clientCostTotals(expenses, tripClientIds, clientId);

  const truncated =
    direct.rows.length === COST_LIMIT ||
    viaTrip.rows.length === COST_LIMIT ||
    tripsResult.rows.length === COST_LIMIT;

  return (
    <Card>
      <Flex justify="between" align="center" wrap="wrap" gap="3" mb="1">
        <Text as="div" size="4" weight="bold">
          Costs
        </Text>
        <Flex gap="2" wrap="wrap">
          <Button asChild size="1" variant="soft">
            <NextLink href={`/expenses?client=${clientId}`}>See every cost</NextLink>
          </Button>
          <Button asChild size="1" variant="soft">
            <NextLink href={`/expenses/new?client=${clientId}`}>Record a cost</NextLink>
          </Button>
        </Flex>
      </Flex>
      <Text as="div" size="2" color="gray" mb="3">
        {totals.count === 0
          ? `Nothing recorded against ${clientName} yet, on a trip or off one.`
          : `${totals.count} expense${totals.count === 1 ? "" : "s"}, on their trips and attributed to them directly.`}
      </Text>

      {totals.count > 0 ? (
        <Grid columns={{ initial: "1", sm: "4" }} gap="3">
          <Figure label="Total" cents={totals.totalCents} emphasis />
          <Figure label="To rebill" cents={totals.rebillCents} />
          <Figure label="Deducted" cents={totals.deductCents} />
          <Figure label="Unfiled" cents={totals.unassignedCents} />
        </Grid>
      ) : null}

      {truncated ? (
        <Callout.Root color="amber" mt="3">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            {`These figures may be partial. More than ${COST_LIMIT} records were involved and only the first ${COST_LIMIT} were totaled.`}
          </Callout.Text>
        </Callout.Root>
      ) : null}
    </Card>
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
    <Flex direction="column" gap="1">
      <Text size="1" color="gray">
        {label}
      </Text>
      <Text size={emphasis ? "5" : "3"} weight={emphasis ? "bold" : "medium"} className="tnum">
        {formatCents(cents)}
      </Text>
    </Flex>
  );
}

function FailedState() {
  return (
    <Card>
      <Callout.Root color="red">
        <Callout.Icon>
          <ExclamationTriangleIcon />
        </Callout.Icon>
        <Callout.Text>
          Couldn&rsquo;t load this client&rsquo;s costs. The figures are
          unavailable rather than zero. Try reloading the page.
        </Callout.Text>
      </Callout.Root>
    </Card>
  );
}
