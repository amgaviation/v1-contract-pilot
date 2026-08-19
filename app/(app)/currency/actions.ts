"use server";

import { revalidatePath } from "next/cache";
import { isCurrencyEngineEnabled } from "@/lib/currency/gate";
import { evaluateCurrency } from "@/lib/currency";
import { loadCurrencyInput, recordSnapshots } from "@/lib/currency/read";
import { isNextControlFlowError, utcDateOf } from "./presentation";
import { BRAND } from "@/lib/brand";

/**
 * The recompute round trip's whole result, echoed back to the form via
 * useActionState so success and failure are both VISIBLE — a recompute
 * button that silently succeeds is indistinguishable from one that
 * silently failed, and on this board staleness is safety-relevant.
 */
export type RecomputeState =
  | { ok: true; recordedCount: number; recordedAtIso: string; asOf: string }
  | { ok: false; error: string }
  | null;

/**
 * Compute + snapshot, exactly the path lib/currency/read.ts's contract
 * lays out: loadCurrencyInput (the ONLY read), evaluateCurrency (pure),
 * recordSnapshots (the ONLY write, append-only — recomputing writes a new
 * row, never rewrites yesterday's answer). The board itself computes
 * fresh on every page load; what this action adds is the durable,
 * auditable snapshot row batch and a visible receipt of when it happened.
 *
 * Auth is enforced inside loadCurrencyInput/recordSnapshots themselves
 * (both call requireAccount("/currency")), and the engine flag is
 * enforced twice: checked here first so a flag-off deployment gets a
 * sentence rather than a thrown assertion, and asserted again inside
 * read.ts (assertCurrencyEngineEnabled) so this action could not bypass
 * the gate even if this check were deleted.
 */
export async function recomputeCurrency(
  _prev: RecomputeState,
  _formData: FormData
): Promise<RecomputeState> {
  if (!isCurrencyEngineEnabled()) {
    return {
      ok: false,
      error: "Currency isn't enabled on this deployment. Nothing was computed or recorded.",
    };
  }

  // The same as-of convention the page render uses (see utcDateOf's
  // comment): the server's UTC calendar date, threaded explicitly through
  // recordSnapshots so as_of and the evaluated windows cannot disagree.
  const asOf = utcDateOf(new Date());

  try {
    const input = await loadCurrencyInput({ asOf, intendedTail: null });
    const results = evaluateCurrency(input);
    await recordSnapshots(results, asOf);
    revalidatePath("/currency");
    return {
      ok: true,
      recordedCount: results.length,
      recordedAtIso: new Date().toISOString(),
      asOf,
    };
  } catch (e) {
    // redirect()/notFound() throw through here on purpose — swallowing
    // them would break the login redirect requireAccount performs.
    if (isNextControlFlowError(e)) throw e;
    // A failed write is reported as NOT recorded — read.ts already treats
    // an unconfirmed insert count as a failure, never as success, and
    // this surface must not soften that into "probably fine." The board
    // itself is unaffected: it recomputes live on the next render.
    return {
      ok: false,
      error:
        `The recompute didn't complete, so no snapshot was recorded. The board still shows a fresh computation on every page load. Try again, and email ${BRAND.supportEmail} if this keeps happening.`,
    };
  }
}
