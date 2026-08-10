import "server-only";

/**
 * CONVENTION — read this before adding a new signed-in screen that reads
 * from Supabase and renders an empty state.
 *
 * THE SHAPE THIS CLOSES: `const rows = (res.data ?? []) as T[]` collapses
 * two different facts into the same value — "the table genuinely has no
 * rows" and "the read failed and we don't know" — and every empty-state
 * branch built on `rows.length === 0` from that point on has no way to
 * tell them apart. A pilot then sees "No unpaid invoices" or "$0.00" on a
 * screen whose query actually errored. That happened five times on one
 * screen (see the review this file was added to close), a reviewer found
 * five more of the identical shape elsewhere in the app within the hour,
 * and it is the same defect class that cost the currency engine in this
 * repo six review rounds before anyone closed the CLASS instead of the
 * instances — see lib/currency's own history.
 *
 * THE RULE: an empty state answers "you have none of these yet." A failed
 * query answers "we could not find out." They must never render the same
 * thing, and where the two cannot be told apart, say the second one —
 * admitting the screen is broken is better than claiming a clean $0.
 *
 * USE THIS AT THE BOUNDARY, once per list read, instead of `data ?? []`:
 *
 *   const tripsResult = rowsOf(await supabase.from("trips").select(...));
 *   if (!tripsResult.ok) {
 *     // render the FAILED state — a Callout, a thrown Error, whatever
 *     // this screen already does for a hard failure — never the empty one.
 *   }
 *   tripsResult.rows.length === 0   // now genuinely means "no trips"
 *
 * `rows` only exists on the `ok: true` branch of the union below — TypeScript
 * refuses to compile a read of `.rows` before `.ok` has been narrowed, so
 * the mistake this file exists to prevent doesn't type-check rather than
 * merely being against house style.
 *
 * NOT EVERY READ ON A PAGE NEEDS an `if (!x.ok) return errorState` of its
 * own — several sources often feed one panel or one figure (Overview's KPI
 * cards, the reports' `report.error` union of many queries). In that
 * shape, fold each `rowsOf(...)` result's `.ok` into the ONE boolean that
 * already gates that panel or figure, the same way the rest of this
 * codebase composes `xError ?? yError ?? zError`. The type safety this file
 * buys is at the point each read is unwrapped, not a requirement that every
 * read get its own Callout.
 */

export type DbErrorLike = { code?: string | null; message?: string | null };

export type QueryRows<T> = { ok: true; rows: T[] } | { ok: false; error: DbErrorLike };

/**
 * Wraps a Supabase `{ data, error }` result — pass the awaited query
 * result straight in. `data` is only ever read here, and only on the `ok:
 * true` branch, so a caller cannot accidentally treat a failed read's null
 * `data` as zero rows.
 */
export function rowsOf<T>(res: {
  data: T[] | null;
  error: DbErrorLike | null;
}): QueryRows<T> {
  if (res.error) return { ok: false, error: res.error };
  return { ok: true, rows: res.data ?? [] };
}

/**
 * THE COUNT READ, which is the same shape wearing a different coat — and the
 * one the first version of this file could not have helped with.
 *
 * `.select("id", { count: "exact", head: true })` returns its value in
 * `count`, not `data`, so `rowsOf` structurally cannot wrap it: its signature
 * asks for `data: T[] | null`. A reviewer pointed that out immediately after
 * this file shipped, and the observation is sharper than it first looks — of
 * the four such reads in the render surface, three were still discarding their
 * error, and EVERY ONE of them exists for the same purpose: to stop an empty
 * screen from telling a pilot "you have none of these" when the truth is
 * "you have some, they are just in another state". A failed count silently
 * becomes 0, which is precisely the reassuring number, and the sentence the
 * screen then prints is the one that reads as good news.
 *
 * So the helper that closes the class has to cover the shape the class
 * actually takes. Same union, same narrowing, same guarantee: `count` exists
 * only once `ok` is true.
 *
 *   const pending = countOf(
 *     await supabase.from("trips").select("id", { count: "exact", head: true })…
 *   );
 *   if (!pending.ok) { … } else if (pending.count > 0) { … }
 *
 * A null `count` with no error is treated as a FAILURE rather than as zero.
 * PostgREST returns null when the exact-count preference was not honoured —
 * which is not the same fact as "there are none", and this whole file exists
 * because those two facts kept being collapsed into one.
 */
export type QueryCount = { ok: true; count: number } | { ok: false; error: DbErrorLike };

export function countOf(res: {
  count: number | null;
  error: DbErrorLike | null;
}): QueryCount {
  if (res.error) return { ok: false, error: res.error };
  if (res.count === null) {
    return {
      ok: false,
      error: { code: null, message: "The count came back empty rather than as a number." },
    };
  }
  return { ok: true, count: res.count };
}
