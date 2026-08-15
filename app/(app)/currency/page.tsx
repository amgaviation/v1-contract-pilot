import { Callout, Flex, Grid, Text } from "@/components/ui";
import { ExclamationTriangleIcon, InfoCircledIcon } from "@radix-ui/react-icons";
import { requireAccount } from "@/lib/supabase/account";
import { CURRENCY_DISCLAIMER } from "@/lib/brand";
import { isCurrencyEngineEnabled } from "@/lib/currency/gate";
import { evaluateCurrency } from "@/lib/currency";
import { loadCurrencyInput } from "@/lib/currency/read";
import type { CurrencyResult } from "@/lib/currency/types";
import PageShell from "../page-shell";
import CurrencyCard from "./currency-card";
import RecomputeButton from "./recompute-button";
import { formatCurrencyDate, isNextControlFlowError, utcDateOf } from "./presentation";

export const metadata = { title: "Currency" };

/**
 * The currency board — the first (and only) screen that renders the
 * currency engine's output. Three states, none of which is an empty card
 * grid:
 *
 *   FLAG OFF   an honest "not enabled on this deployment" notice. The
 *              engine ships dark (lib/currency/gate.ts) until its
 *              reviews are signed off; this page must render that fact,
 *              never crash on read.ts's assertion, and never imply the
 *              feature is merely loading.
 *   READ FAILED a refuse state: "we could not find out" — which is a
 *              different fact from "you have nothing to worry about" and
 *              must never render like it (lib/supabase/rows.ts, THE
 *              RULE). No cards render at all, because four honest cards
 *              next to one silently missing one reads as "fine".
 *   LOADED     the five-card board, computed fresh from the pilot's own
 *              logbook on every render, with the counsel-reviewed
 *              disclaimer ABOVE the cards (docs/CURRENCY-SPEC.md §7 — it
 *              travels with the data, never a footnote) and the as-of
 *              date prominent, because staleness is safety-relevant.
 *
 * All data access goes through lib/currency/read.ts — the engine's only
 * I/O module — and every sentence of currency prose comes from the
 * engine's own describe/notes/assumptions strings, rendered verbatim.
 */
export default async function CurrencyPage() {
  await requireAccount("/currency");

  if (!isCurrencyEngineEnabled()) {
    return (
      <PageShell
        title="Currency"
        subtitle="Estimated FAA currency, computed from your own logbook entries"
      >
        <Callout.Root color="gray">
          <Callout.Icon>
            <InfoCircledIcon />
          </Callout.Icon>
          <Callout.Text>
            <Text as="div" weight="medium">
              Currency isn&rsquo;t enabled on this deployment.
            </Text>
            <Text as="div" size="2">
              The currency board ships dark behind a deployment flag until its regulatory
              spec review and the counsel review of its disclaimer are signed off. Until
              the flag is set on this deployment, nothing here computes, reads, or shows
              currency. This notice is the whole feature. There is no in-app switch.
            </Text>
          </Callout.Text>
        </Callout.Root>
      </PageShell>
    );
  }

  // The server's UTC calendar date — the one as-of convention this board
  // uses everywhere (see utcDateOf's comment for why not the client's
  // local date). Every window on every card below is evaluated against
  // this exact date, and the recompute action derives its own asOf the
  // same way.
  const asOf = utcDateOf(new Date());

  let results: CurrencyResult[] | null = null;
  try {
    const input = await loadCurrencyInput({ asOf, intendedTail: null });
    results = evaluateCurrency(input);
  } catch (e) {
    // requireAccount inside loadCurrencyInput redirects by throwing —
    // that must propagate, not render as a failure.
    if (isNextControlFlowError(e)) throw e;
    results = null;
  }

  // A currency board must NEVER render an empty card grid — five absent
  // cards read as "nothing to worry about", which is the one lie this
  // screen exists to never tell. evaluateCurrency contractually returns
  // exactly five results; if that ever stops being true, refuse loudly
  // rather than render the reassuring blank.
  if (results !== null && results.length === 0) {
    results = null;
  }

  if (results === null) {
    return (
      <PageShell
        title="Currency"
        subtitle="Estimated FAA currency, computed from your own logbook entries"
      >
        <Callout.Root color="red">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            <Text as="div" weight="medium">
              Couldn&rsquo;t read your logbook, so no currency estimates are shown.
            </Text>
            <Text as="div" size="2">
              This is not a statement that you are current, and not a statement that you
              are not. It means this screen could not find out. Reload to try again; if
              it keeps failing, contact support. Your logbook itself is unaffected.
            </Text>
          </Callout.Text>
        </Callout.Root>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Currency"
      subtitle={`Estimated from your logbook as of ${
        formatCurrencyDate(asOf) ?? asOf
      } (UTC), computed fresh on this page load`}
      action={<RecomputeButton />}
    >
      {/* COUNSEL-REVIEWED COPY, verbatim from lib/brand.ts — never
          paraphrased, never separated from the data below it, rendered
          above the cards per docs/CURRENCY-SPEC.md §7. The same string
          travels inside every snapshot the recompute action writes
          (currency_snapshots.limitations, NOT NULL). */}
      <Callout.Root color="blue">
        <Callout.Icon>
          <InfoCircledIcon />
        </Callout.Icon>
        <Callout.Text>{CURRENCY_DISCLAIMER}</Callout.Text>
      </Callout.Root>

      <Flex direction="column" gap="1">
        <Text size="2" weight="medium" as="div">
          {`As of ${formatCurrencyDate(asOf) ?? asOf}`}
        </Text>
        <Text size="1" color="gray" as="div">
          Every window below is evaluated against the UTC calendar date above. Each card
          states its own arithmetic and the entries it counted. The estimate is only as
          good as the logbook it reads.
        </Text>
      </Flex>

      {/* evaluateCurrency always returns exactly five results, one per
          currency type, in vocabulary order — an absent card would read
          as "fine", so the engine never omits one and this page renders
          whatever it returns, unfiltered. */}
      <Grid columns={{ initial: "1", md: "2" }} gap="4">
        {results.map((result) => (
          <CurrencyCard key={result.currencyType} result={result} />
        ))}
      </Grid>
    </PageShell>
  );
}
