/**
 * Splitting an id list into requests a URL can actually carry.
 *
 * PostgREST's `.in("id", ids)` serialises every id into the GET query
 * string. A uuid costs 39 bytes there once the comma and quoting are
 * counted, so a thousand of them is roughly 39 KB of URL before anything
 * else in the request. Common proxy and server limits sit between 8 KB and
 * 16 KB, so the request does not come back truncated, it comes back as an
 * error -- and a screen built to warn about partial totals renders its
 * hard-failure state instead, on a figure that would otherwise have been
 * merely incomplete.
 *
 * 100 ids per request keeps a batch near 4 KB, comfortably inside the
 * smallest limit worth designing for, and a thousand ids costs ten
 * requests rather than one failure.
 */

export const ID_CHUNK_SIZE = 100;

export function idChunks<T>(ids: readonly T[], size: number = ID_CHUNK_SIZE): T[][] {
  if (size < 1) throw new Error("idChunks: size must be at least 1");
  const chunks: T[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}
