/**
 * Turns a PostgREST/Postgres error into a sentence a pilot can act on.
 *
 * WHY NOT JUST RENDER `error.message`: it carries internal schema —
 * table names, constraint names like `trips_account_id_client_id_fkey`,
 * and, for a grant denial, the exact column that was withheld. None of
 * that is another tenant's data, but it is a map of what to probe, and it
 * is useless to the person reading it. Known codes get a sentence; the
 * rest get a generic line and the detail goes to the server log where it
 * is actually useful.
 */

type PostgrestLike = {
  code?: string | null;
  message?: string | null;
};

const BY_CODE: Record<string, string> = {
  // insufficient_privilege — a column the tenant may not write. If a user
  // ever sees this it is our bug, not theirs.
  "42501": "That change isn't allowed on this record.",
  // foreign_key_violation — the referenced row is gone, belongs to
  // someone else, or something still depends on this one.
  "23503": "That record is linked to something else, so it can't be changed or removed.",
  // unique_violation
  "23505": "That already exists.",
  // check_violation
  "23514": "Some of those values aren't valid together.",
  // not_null_violation
  "23502": "Something required is missing.",
  // invalid_text_representation — e.g. a malformed uuid
  "22P02": "That request wasn't valid.",
};

export function friendlyDbError(
  error: PostgrestLike | null | undefined,
  context: string
): string {
  if (!error) return "Something went wrong. Try again.";

  // Server-side only; never reaches the browser.
  console.error(`[db] ${context}`, {
    code: error.code ?? null,
    message: error.message ?? null,
  });

  const code = error.code ?? "";
  return BY_CODE[code] ?? "Couldn't save that. Try again.";
}
