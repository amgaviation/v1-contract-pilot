/**
 * THE TENANT'S FILING TAXONOMY — the pure half.
 *
 * Phase 9 Layer 3. `pilot.custom_options` (20260813000000) holds the
 * label, order and retirement of the three pickers a pilot files work
 * into: expense category, trip kind, document kind. This module is the
 * one place the app knows what those vocabularies ARE, and the one place
 * a stored row is turned into something a picker or a history screen can
 * render.
 *
 * DELIBERATELY PURE — no "server-only", no Supabase import, no I/O. That
 * is what lets tests/custom-options.test.mjs exercise the real functions,
 * and what lets a client picker take an OptionChoice[] as a prop without
 * dragging a server module into the browser bundle. The database read
 * lives next door in lib/custom-options-read.ts.
 *
 * ===========================================================================
 * THE CONSTRAINT THAT SHAPES EVERY FUNCTION BELOW, stated once, in full.
 *
 * All three columns these options feed still carry a CHECK pinning them to
 * exactly the built-in keys:
 *
 *   pilot.expenses.category    expenses_category_check      (20260810070000)
 *   pilot.trips.trip_kind      trip_kind check              (20260805070000)
 *   pilot.documents.kind       documents_kind_check         (20260807140000)
 *
 * 20260813000000's own header says so explicitly, and says why widening
 * them is a separate, deliberate decision rather than a side effect of
 * shipping customisation. The consequence for this file is precise:
 *
 *   custom_options is today the RENAME / REORDER / ARCHIVE layer over the
 *   built-in vocabularies. It is NOT yet an "add your own key" layer.
 *
 * A pilot may call `rideshare` "Uber & Lyft", push `dues` to the bottom,
 * and retire `w9` from the picker. A brand-new key would be refused by the
 * CHECK the moment a row tried to use it — so `choicesFor` below FILTERS
 * any key that is not in the built-in vocabulary out of the picker, rather
 * than offering a value the table would reject. A picker that offers a
 * value the database refuses is worse than one that does not offer it.
 *
 * That filter is a guard, not a formality: nothing in the app can create
 * such a row today (there is no add path — see the categories panel), but
 * a hand-written INSERT, a restored backup, or a future migration that
 * widens the CHECKs in a different order would all arrive here first.
 * When the CHECKs ARE widened, flip the domain's entry in
 * DOMAIN_KEYS_ARE_PINNED and the filter stops applying to it.
 * ===========================================================================
 */

export const CUSTOM_OPTION_DOMAINS = [
  "expense_category",
  "trip_kind",
  "document_kind",
] as const;

export type CustomOptionDomain = (typeof CUSTOM_OPTION_DOMAINS)[number];

/** What a `<Select.Item>` needs: the stored key, and what the pilot reads. */
export type OptionChoice = { value: string; label: string };

/**
 * The slice of a `pilot.custom_options` row every screen here works from.
 * Structurally compatible with the generated Row type, but declared
 * independently so this module stays free of the Database import (and so
 * a test can hand it a plain object).
 */
export type CustomOptionRow = {
  id: string;
  domain: string;
  key: string;
  label: string;
  sort_order: number;
  is_builtin: boolean;
  archived_at: string | null;
};

/**
 * THE BUILT-IN VOCABULARIES — the same 15 / 7 / 8 keys, in the same order,
 * with the same labels that pilot.seed_custom_options seeds into every
 * tenant. If this list and a CHECK constraint ever disagree, the CHECK is
 * right and this is the bug (the migration's seeder says the same thing
 * about itself).
 *
 * Two jobs, both load-bearing:
 *
 *   1. THE FALLBACK. A failed read of custom_options must never produce an
 *      empty picker — a pilot who cannot file an expense because a
 *      settings table was briefly unreadable is a far worse outcome than
 *      one who briefly sees the stock labels. Every function below falls
 *      back here.
 *   2. THE STORABILITY FILTER. These are exactly the keys the three CHECK
 *      constraints permit, so they are exactly the keys a picker may
 *      offer. See this file's header.
 */
export const BUILTIN_OPTIONS = {
  // pilot.expenses.expenses_category_check — the travel eight
  // (20260805070000) followed by the seven a freelance pilot self-funds
  // and deducts (20260810070000).
  expense_category: [
    { value: "airline", label: "Airline" },
    { value: "hotel", label: "Hotel" },
    { value: "rental_car", label: "Rental car" },
    { value: "rideshare", label: "Rideshare" },
    { value: "fuel", label: "Fuel" },
    { value: "meals", label: "Meals" },
    { value: "parking", label: "Parking" },
    { value: "other", label: "Other" },
    { value: "training", label: "Training / recurrent" },
    { value: "medical", label: "Medical exam" },
    { value: "insurance", label: "Insurance (own)" },
    { value: "charts", label: "Charts / EFB subscription" },
    { value: "equipment", label: "Equipment" },
    { value: "uniform", label: "Uniform" },
    { value: "dues", label: "Dues / publications" },
  ],
  // pilot.trips' trip_kind CHECK. Ordered as the trip form has always
  // ordered it — contract_pilot first, because that is the job. The
  // CHECK's own order is alphabetical-by-accident.
  trip_kind: [
    { value: "contract_pilot", label: "Contract pilot" },
    { value: "owner_trip", label: "Owner trip" },
    { value: "repositioning", label: "Repositioning" },
    { value: "ferry", label: "Ferry" },
    { value: "maintenance_flight", label: "Maintenance flight" },
    { value: "delivery_flight", label: "Delivery flight" },
    { value: "other", label: "Other" },
  ],
  // pilot.documents.documents_kind_check. "certificate", not "license" —
  // there is no such thing as a pilot license in US airman terms. See
  // app/(app)/documents/kinds.ts, which derives its DOCUMENT_KINDS from
  // this list and carries the full regulatory reasoning for each entry.
  document_kind: [
    { value: "medical", label: "Medical certificate" },
    { value: "flight_review", label: "Flight review" },
    { value: "pic_proficiency_check", label: "PIC proficiency check (61.58)" },
    { value: "passport", label: "Passport" },
    { value: "certificate", label: "Certificate" },
    { value: "insurance", label: "Insurance" },
    { value: "w9", label: "W-9" },
    { value: "other", label: "Other" },
  ],
  // `as const satisfies` rather than a plain type annotation: the
  // annotation would WIDEN every value to `string`, and two call sites
  // depend on the literals surviving — app/(app)/documents/actions.ts
  // derives its validation vocabulary from this list and needs it to
  // narrow to the Row type's union (it was a hand-copied array once, and
  // it had silently fallen a value behind), and the same holds for
  // anything that later derives a union from a domain. `satisfies` still
  // type-checks the shape, so a typo'd key or a missing label is a
  // compile error exactly as before.
} as const satisfies Record<CustomOptionDomain, readonly OptionChoice[]>;

/**
 * Whether the column this domain feeds still pins its vocabulary with a
 * CHECK. `true` everywhere today — see this file's header. Flip an entry
 * to `false` in the same change that widens that column's CHECK, and the
 * storability filter and the "you cannot add one yet" copy in the
 * categories panel both stand down for that domain together.
 */
export const DOMAIN_KEYS_ARE_PINNED: Record<CustomOptionDomain, boolean> = {
  expense_category: true,
  trip_kind: true,
  document_kind: true,
};

/** The keys a domain's column will actually accept today. */
export function storableKeys(domain: CustomOptionDomain): ReadonlySet<string> {
  return new Set(BUILTIN_OPTIONS[domain].map((option) => option.value));
}

export function isCustomOptionDomain(value: unknown): value is CustomOptionDomain {
  return (
    typeof value === "string" &&
    (CUSTOM_OPTION_DOMAINS as readonly string[]).includes(value)
  );
}

/**
 * Rows for one domain, in the order a pilot arranged them.
 *
 * `sort_order` first, then `key` — the same tiebreak the settings page
 * already uses for day types, so two options a pilot never reordered stay
 * in a stable, non-arbitrary order instead of shuffling between renders.
 */
export function rowsForDomain(
  rows: readonly CustomOptionRow[],
  domain: CustomOptionDomain
): CustomOptionRow[] {
  return rows
    .filter((row) => row.domain === domain)
    .slice()
    .sort((a, b) =>
      a.sort_order === b.sort_order
        ? a.key.localeCompare(b.key)
        : a.sort_order - b.sort_order
    );
}

/**
 * WHAT A PICKER OFFERS. Archived options are excluded (that is what
 * archiving is for) and — while the domain's CHECK is still in place —
 * any key the column would refuse is excluded too, so this function can
 * never hand a form a value that cannot be saved.
 *
 * Falls back to the built-in list when nothing survives, which covers the
 * three cases that all look identical from here: the read failed, the
 * tenant predates the backfill, or a pilot archived every single option.
 * A picker with no options is not a legitimate state of this product.
 */
export function choicesFor(
  rows: readonly CustomOptionRow[],
  domain: CustomOptionDomain
): OptionChoice[] {
  const pinned = DOMAIN_KEYS_ARE_PINNED[domain];
  const storable = storableKeys(domain);

  const choices = rowsForDomain(rows, domain)
    .filter((row) => row.archived_at === null)
    .filter((row) => !pinned || storable.has(row.key))
    .map((row) => ({ value: row.key, label: row.label }));

  return choices.length > 0 ? choices : [...BUILTIN_OPTIONS[domain]];
}

/**
 * WHAT HISTORY RENDERS. Every key the app knows about, mapped to what the
 * pilot calls it — INCLUDING archived options, and including any key the
 * storability filter above keeps out of the picker.
 *
 * This is the whole reason custom_options archives instead of deleting.
 * Three years of expenses filed under `hotel` must keep rendering as
 * whatever `hotel` is called, whether or not it is still offered for new
 * ones. The built-in labels are the base layer so a key with no row (a
 * tenant provisioned before the backfill, a read that returned a partial
 * set) still resolves to a sentence rather than a raw key.
 */
export function labelsFor(
  rows: readonly CustomOptionRow[],
  domain: CustomOptionDomain
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const option of BUILTIN_OPTIONS[domain]) {
    labels[option.value] = option.label;
  }
  for (const row of rowsForDomain(rows, domain)) {
    labels[row.key] = row.label;
  }
  return labels;
}

/**
 * The label for one stored key, for the screens that render a single
 * record. Unknown keys fall back to "Other"'s label where the domain has
 * one, then to the raw key — never to an empty cell.
 */
export function labelForKey(
  labels: Record<string, string>,
  key: string | null | undefined
): string {
  if (!key) return "—";
  return labels[key] ?? key;
}
