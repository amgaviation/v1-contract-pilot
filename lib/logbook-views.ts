/**
 * SAVED LOGBOOK VIEWS — the third key in `pilot.account_preferences.prefs`,
 * and the module that owns it.
 *
 * ===========================================================================
 * WHAT A VIEW IS. A contract pilot does not read their logbook front to
 * back. They read slices of it, and the same three or four slices over and
 * over: "N447SP" because the owner asked how much time is on their
 * aeroplane, "CE-500, as PIC" because that is the line an underwriter's
 * form wants, "this year" because a chief pilot asked what they have been
 * flying. Each of those is a filter that takes ten seconds to rebuild and
 * gets rebuilt weekly. A view is that filter, named, so it is one click.
 *
 * A view is a QUESTION, never an answer: it stores which entries to look
 * at and nothing about what the answer was. Nothing here caches a total,
 * and nothing here concludes anything — see the header of
 * app/(app)/reports/pilot-history/report-lib.ts for the rule this feature
 * is built to, which governs this file too.
 *
 * ===========================================================================
 * TOTALITY, and why it is not optional here.
 *
 * These live in a jsonb blob whose only database-enforced guarantees are
 * "is a JSON object" and "under 16 KB" (20260813000000). The row outlives
 * the build that wrote it: a facet this version stores can be renamed or
 * retired by the next one, a restored backup can hold anything, and a
 * support fix applied with the service-role key answers to nothing. So
 * `resolveLogbookViews` is TOTAL over `unknown` — every input, including
 * `null`, a string, an array of numbers, or a view whose filter names a
 * role that no longer exists, resolves to a valid (possibly empty) list
 * rather than throwing or producing a filter the query layer cannot
 * express. lib/theme-slots.ts's resolveThemeSlots and lib/nav.ts's
 * normalizeNavLayout are the two existing instances of this contract;
 * lib/preferences.ts's header is where the reasoning is written out in
 * full.
 *
 * A facet that does not resolve is DROPPED, not defaulted to something
 * else. Dropping a facet widens the result set — the pilot sees more
 * entries than they asked for, and can see that they did. Guessing a
 * replacement value would narrow it, and a logbook screen that silently
 * hides entries is the one failure mode a 61.51 record must not have.
 *
 * ===========================================================================
 * THE NAME IS THE KEY, deliberately, and there is no generated id.
 *
 * Saving a view whose name matches one already stored REPLACES it, which
 * is what "save" means to someone who just adjusted a filter they had
 * saved before. An id plus a name would need a rename affordance to be
 * worth anything, would let two views share a name (a picker with two
 * identical rows), and would need to survive a blob written by a build
 * that did not have ids. Matching is case- and whitespace-insensitive so
 * "N447SP" and "n447sp " are one view rather than two.
 *
 * ===========================================================================
 * THE 16 KB BUDGET. The preferences row holds the theme and the nav layout
 * too, and the CHECK is on the whole object. MAX_LOGBOOK_VIEWS and
 * MAX_VIEW_NAME below bound this key's contribution to roughly 3 KB in the
 * worst case, which leaves the column's own limit doing what it is for —
 * catching something storing documents in the settings table — rather than
 * being reachable by a pilot who likes saving views.
 */

/**
 * The crew roles a view may filter on — pilot.logbook_entries' own
 * vocabulary (20260809000000). A wholly-simulator entry has a NULL role
 * and is therefore excluded by ANY role filter, which is correct: filtering
 * to "as PIC" should not return a session in a box.
 */
export const LOGBOOK_VIEW_ROLES = ["PIC", "SIC", "SOLO", "DUAL_RECEIVED"] as const;
export type LogbookViewRole = (typeof LOGBOOK_VIEW_ROLES)[number];

export const LOGBOOK_VIEW_ROLE_LABEL: Record<LogbookViewRole, string> = {
  PIC: "PIC",
  SIC: "SIC",
  SOLO: "Solo",
  DUAL_RECEIVED: "Dual received",
};

/**
 * One saved slice of the logbook. Every facet is independently nullable
 * and null means "not filtered on" — the all-null filter is the whole
 * logbook, and `pilot.logbook_filtered` is written to agree with that
 * (a NULL argument is not a filter there either).
 */
export type LogbookFilter = {
  /**
   * The NORMALISED tail key, not the registration as written — the same
   * value `pilot.aircraft.tail_key` is generated as, so a view saved
   * against "N-447SP" still matches entries logged as "n447sp". Produced
   * by tailKeyOf() below, which is the one implementation of that
   * normalisation in TypeScript.
   */
  tailKey: string | null;
  /**
   * The type label as `pilot.logbook_time_by_type` groups on it (FAA type
   * rating, else ICAO designator, else whatever the pilot typed on the
   * entry, else "Unspecified"). Stored as the label rather than as an
   * aircraft id on purpose: one label spans every airframe of that type,
   * which is the question being asked.
   */
  typeLabel: string | null;
  role: LogbookViewRole | null;
  /** Inclusive "YYYY-MM-DD" bounds. */
  dateFrom: string | null;
  dateTo: string | null;
};

export type LogbookView = {
  name: string;
  filter: LogbookFilter;
};

export const EMPTY_LOGBOOK_FILTER: LogbookFilter = {
  tailKey: null,
  typeLabel: null,
  role: null,
  dateFrom: null,
  dateTo: null,
};

export const MAX_LOGBOOK_VIEWS = 12;
export const MAX_VIEW_NAME = 60;
/** Matches pilot.aircraft.tail_number's own 2–12 CHECK, post-normalisation. */
const MAX_TAIL_KEY = 12;
const MIN_TAIL_KEY = 2;
/**
 * pilot.aircraft.type_rating is 2–10 chars; a typed-in aircraft_type can be
 * longer, so this is the generous bound the free-text column allows.
 *
 * EXPORTED, because it is a bound the PICKER has to know too.
 * pilot.logbook_entries.aircraft_type is unconstrained text
 * (20260805220000) and an imported logbook can carry anything, so the type
 * picker on /logbook filters its options through this same number. A picker
 * that offered a label the resolver below then dropped would silently
 * un-ask the pilot's question: the whole logbook renders under career
 * totals with no caption, the picker snaps back to "Any type", and nothing
 * says why.
 */
export const MAX_TYPE_LABEL = 60;

/**
 * A registration → the key everything joins on.
 *
 * STRIP FIRST, THEN UPPERCASE — the order `pilot.aircraft.tail_key`'s
 * generated expression uses, and the two orders are NOT equivalent.
 * `'ß'.toUpperCase()` is "SS", so uppercasing first PROMOTES a
 * character Postgres strips: for the tail number "ßß" the
 * reversed order answers "SSSS" while the database stores an empty key.
 * That defect shipped once already (see app/(app)/logbook/aircraft/db.ts,
 * whose tailKey() now delegates here so there is exactly one
 * implementation of this in TypeScript rather than two that have already
 * disagreed).
 */
export function tailKeyOf(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real calendar date, not merely a ten-character string. "2026-02-31"
 * and "2026-13-01" match the shape and are not dates; PostgREST would
 * reject them with a raw type error, so they are dropped here instead.
 */
function isCalendarDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

function readString(source: unknown, key: string): string | null {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    return null;
  }
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

export function isLogbookViewRole(value: unknown): value is LogbookViewRole {
  return LOGBOOK_VIEW_ROLES.some((role) => role === value);
}

/**
 * Untrusted anything → a filter the query layer can express. Total.
 *
 * Accepts the stored jsonb shape AND the URL-parameter shape, because they
 * carry the same five facets under the same names and having one function
 * validate both is what keeps a link a pilot pasted and a view they saved
 * from behaving differently.
 */
export function resolveLogbookFilter(raw: unknown): LogbookFilter {
  const tailRaw = readString(raw, "tailKey") ?? readString(raw, "tail");
  const tail = tailRaw === null ? null : tailKeyOf(tailRaw);
  const tailKey =
    tail !== null && tail.length >= MIN_TAIL_KEY && tail.length <= MAX_TAIL_KEY
      ? tail
      : null;

  const typeRaw = (readString(raw, "typeLabel") ?? readString(raw, "type") ?? "").trim();
  const typeLabel =
    typeRaw !== "" && typeRaw.length <= MAX_TYPE_LABEL ? typeRaw : null;

  const roleRaw = readString(raw, "role");
  const role = isLogbookViewRole(roleRaw) ? roleRaw : null;

  const fromRaw = readString(raw, "dateFrom") ?? readString(raw, "from");
  const toRaw = readString(raw, "dateTo") ?? readString(raw, "to");
  let dateFrom = fromRaw !== null && isCalendarDate(fromRaw) ? fromRaw : null;
  let dateTo = toRaw !== null && isCalendarDate(toRaw) ? toRaw : null;

  // AN IMPOSSIBLE RANGE IS DROPPED WHOLE, both ends, rather than kept or
  // swapped. Kept, it returns nothing and reads as a logbook that lost its
  // entries; swapped, it answers a question nobody asked and looks like it
  // worked. Dropped, the pilot sees their whole logbook — visibly wider
  // than what they typed, which is the direction a record screen should
  // fail in. The form that writes a range validates it and says so; this
  // is the last line for a hand-edited URL or a stale blob. (SavedViews'
  // apply() is where the form validates it and says so — in words, before
  // navigating — so this branch is genuinely the last line rather than the
  // only one.)
  if (dateFrom !== null && dateTo !== null && dateFrom > dateTo) {
    dateFrom = null;
    dateTo = null;
  }

  return { tailKey, typeLabel, role, dateFrom, dateTo };
}

export function logbookFilterIsEmpty(filter: LogbookFilter): boolean {
  return (
    filter.tailKey === null &&
    filter.typeLabel === null &&
    filter.role === null &&
    filter.dateFrom === null &&
    filter.dateTo === null
  );
}

/** Two filters ask the same question. Used to mark the active view in the
 *  picker without storing "which view is selected" anywhere. */
export function logbookFiltersEqual(a: LogbookFilter, b: LogbookFilter): boolean {
  return (
    a.tailKey === b.tailKey &&
    a.typeLabel === b.typeLabel &&
    a.role === b.role &&
    a.dateFrom === b.dateFrom &&
    a.dateTo === b.dateTo
  );
}

/**
 * The filter as URL search parameters, in a fixed key order so the same
 * filter always produces the same link (bookmarkable, and comparable as a
 * string). Empty facets are omitted rather than written as blanks.
 */
export function logbookFilterToParams(filter: LogbookFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.tailKey) params.set("tail", filter.tailKey);
  if (filter.typeLabel) params.set("type", filter.typeLabel);
  if (filter.role) params.set("role", filter.role);
  if (filter.dateFrom) params.set("from", filter.dateFrom);
  if (filter.dateTo) params.set("to", filter.dateTo);
  return params;
}

/** "/logbook" or "/logbook?tail=N447SP&role=PIC". */
export function logbookFilterHref(filter: LogbookFilter, page?: number): string {
  const params = logbookFilterToParams(filter);
  if (page !== undefined && page > 1) params.set("page", String(page));
  const query = params.toString();
  return query === "" ? "/logbook" : `/logbook?${query}`;
}

/**
 * A Next.js `searchParams` object → a filter. `string[]` (a repeated
 * parameter) resolves to the FIRST value rather than being dropped: a
 * duplicated query key is almost always a link built twice, and answering
 * the first one is closer to what was asked than answering nothing.
 */
export function logbookFilterFromSearchParams(
  searchParams: Record<string, string | string[] | undefined>
): LogbookFilter {
  const first = (value: string | string[] | undefined): string | null => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : null;
    return null;
  };
  return resolveLogbookFilter({
    tail: first(searchParams.tail),
    type: first(searchParams.type),
    role: first(searchParams.role),
    from: first(searchParams.from),
    to: first(searchParams.to),
  });
}

/**
 * A short human sentence for the filter — the caption under a filtered
 * total, so the number is never printed without what it is a total OF. An
 * empty filter describes itself as the whole logbook rather than as
 * nothing.
 */
export function describeLogbookFilter(
  filter: LogbookFilter,
  /** The registration as the pilot writes it, when the caller has the
   *  registry row in hand — "N-447SP" reads better than the key "N447SP". */
  tailNumber?: string | null
): string {
  if (logbookFilterIsEmpty(filter)) return "Every entry in your logbook";

  const parts: string[] = [];
  if (filter.tailKey) parts.push(tailNumber?.trim() || filter.tailKey);
  if (filter.typeLabel) parts.push(filter.typeLabel);
  if (filter.role) parts.push(`as ${LOGBOOK_VIEW_ROLE_LABEL[filter.role]}`);
  if (filter.dateFrom && filter.dateTo) {
    parts.push(`${filter.dateFrom} to ${filter.dateTo}`);
  } else if (filter.dateFrom) {
    parts.push(`on or after ${filter.dateFrom}`);
  } else if (filter.dateTo) {
    parts.push(`on or before ${filter.dateTo}`);
  }
  return parts.join(" · ");
}

/** Whitespace-collapsed, trimmed, length-capped. The stored form. */
function normalizeViewName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_VIEW_NAME);
}

/** The comparison key — see the header on why the name IS the key. */
export function viewNameKey(name: string): string {
  return normalizeViewName(name).toLowerCase();
}

/**
 * Untrusted jsonb → the saved views. Total: never throws, never returns a
 * view whose filter the query layer cannot express, never returns two
 * views the picker would render identically.
 *
 * A view whose filter resolves to EMPTY is dropped. It is not an error, it
 * is a view that has lost every facet it was saved with — clicking it
 * would show the whole logbook under a name promising a slice of it, which
 * is worse than the pilot noticing it is gone and saving it again.
 */
export function resolveLogbookViews(raw: unknown): LogbookView[] {
  if (!Array.isArray(raw)) return [];

  const out: LogbookView[] = [];
  const seen = new Set<string>();

  for (const candidate of raw) {
    if (out.length >= MAX_LOGBOOK_VIEWS) break;
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      continue;
    }
    const nameRaw = readString(candidate, "name");
    if (nameRaw === null) continue;
    const name = normalizeViewName(nameRaw);
    if (name === "") continue;

    const key = viewNameKey(name);
    if (seen.has(key)) continue;

    const filter = resolveLogbookFilter(
      (candidate as Record<string, unknown>).filter
    );
    if (logbookFilterIsEmpty(filter)) continue;

    seen.add(key);
    out.push({ name, filter });
  }

  return out;
}

export type SaveViewResult =
  | { ok: true; views: LogbookView[] }
  | { ok: false; error: string };

/**
 * Add or replace a view by name, keeping the list in save order with the
 * most recently saved LAST — a picker that reshuffles itself every time
 * you save is a picker you have to re-read every time.
 *
 * Replacing an existing name keeps that view's POSITION rather than moving
 * it to the end: adjusting a filter you already had should not move it in
 * the list you have learned the order of.
 *
 * The SPELLING the pilot just typed wins, though — saving "citation" over
 * "Citation" stores "citation". Matching is case-insensitive so the two
 * are one view rather than two, and once they are one view, the name in
 * front of the pilot is the one they most recently chose. This is the only
 * rename path there is; a separate one would be a control for a list most
 * accounts will hold three entries in.
 */
export function saveLogbookView(
  views: readonly LogbookView[],
  nameRaw: string,
  filter: LogbookFilter
): SaveViewResult {
  const name = normalizeViewName(nameRaw);
  if (name === "") {
    return { ok: false, error: "Give this view a name so you can find it again." };
  }
  if (logbookFilterIsEmpty(filter)) {
    return {
      ok: false,
      error:
        "There's nothing to save yet — narrow the logbook by aircraft, type, role or dates first.",
    };
  }

  const key = viewNameKey(name);
  const index = views.findIndex((view) => viewNameKey(view.name) === key);
  if (index === -1 && views.length >= MAX_LOGBOOK_VIEWS) {
    return {
      ok: false,
      error: `You can keep ${MAX_LOGBOOK_VIEWS} saved views. Delete one you no longer use, or save over it by reusing its name.`,
    };
  }

  const next = views.slice();
  if (index === -1) {
    next.push({ name, filter });
  } else {
    next[index] = { name, filter };
  }
  return { ok: true, views: next };
}

export function removeLogbookView(
  views: readonly LogbookView[],
  nameRaw: string
): LogbookView[] {
  const key = viewNameKey(nameRaw);
  return views.filter((view) => viewNameKey(view.name) !== key);
}

export function findLogbookView(
  views: readonly LogbookView[],
  nameRaw: string
): LogbookView | null {
  const key = viewNameKey(nameRaw);
  return views.find((view) => viewNameKey(view.name) === key) ?? null;
}
