import { parseTenth } from "@/lib/format";

/**
 * Turns the raw text an OCR pass read off a receipt into the three fields
 * an expense actually needs — date, amount, vendor — plus a guess at the
 * category.
 *
 * ***************************************************************************
 * WHAT THIS IS FOR, AND WHAT IT REFUSES TO DO
 * ***************************************************************************
 * A contract pilot photographs a hotel folio at 5am in an FBO lounge. The
 * job here is to save them typing, NOT to file the expense. Every field
 * this returns is a SUGGESTION that lands in a form the pilot confirms —
 * the same draft-confirm boundary the logbook and the bank import use, and
 * for the same reason: a receipt photographed at an angle under sodium
 * light is not evidence, it is a hint.
 *
 * So this module is deliberately conservative. A field it cannot read with
 * reasonable confidence comes back NULL and the pilot types it, which is
 * exactly what they do today. Returning a confidently wrong $1,847.00
 * because a thermal receipt's faded "1" looked like a "7" is far worse
 * than returning nothing: nothing gets typed, wrong gets confirmed.
 *
 * ***************************************************************************
 * WHY THE AMOUNT RULE IS "LABELLED TOTAL, ELSE NOTHING"
 * ***************************************************************************
 * The naive approach — take the largest number on the receipt — is wrong
 * on exactly the receipts this product sees most:
 *
 *   - an FBO fuel invoice lists GALLONS (often 3-4 digits) and a price per
 *     gallon, and the gallons figure can exceed the dollar total on a
 *     small uplift;
 *   - a hotel folio lists a room rate per night, a running balance, AND a
 *     total, and the running balance mid-stay can exceed the final total
 *     after a deposit is applied;
 *   - a rental car agreement lists an estimated total that is not what was
 *     charged.
 *
 * So the amount is taken from a LABELLED total line and nowhere else.
 * "Total", "Amount Due", "Balance Due", "Grand Total", "Charged" — the
 * words that mean "this is what left your account". If none appears, the
 * amount is null.
 *
 * ***************************************************************************
 * AVIATION SPECIFICS
 * ***************************************************************************
 * The category hints are drawn from what a contract pilot's expense file
 * actually contains (see the eight-category vocabulary this product
 * shares with pilot.expenses.category). FBO names are the notable one:
 * "Signature", "Atlantic", "Sheltair", "Million Air", "Ross Aviation" and
 * the like are fuel/handling, and a pilot seeing "Other" for a Signature
 * invoice would rightly conclude the software does not know their world.
 *
 * A tail number or an ICAO on the receipt is captured separately rather
 * than jammed into the vendor: it is the strongest signal for WHICH TRIP
 * this belongs to, which is the association the pilot otherwise makes by
 * hand.
 */

export type ReceiptExtraction = {
  /** ISO calendar date, or null when no confident date was found. */
  date: string | null;
  /** Integer cents from a LABELLED total line only, or null. */
  amountCents: number | null;
  /** Best guess at the merchant, or null. */
  vendor: string | null;
  /** One of pilot.expenses.category, or null when nothing matched. */
  category: ExpenseCategory | null;
  /** A tail number seen on the receipt (N-number or foreign), if any. */
  aircraftIdent: string | null;
  /** ICAO/IATA identifiers seen, in the order found. */
  airportIdents: string[];
  /** Fuel uplift in gallons, when the receipt states it. */
  gallons: number | null;
  /** Which fields were read, for the UI to show what it filled in. */
  filled: ("date" | "amount" | "vendor" | "category")[];
};

export type ExpenseCategory =
  | "airline"
  | "hotel"
  | "rental_car"
  | "rideshare"
  | "fuel"
  | "meals"
  | "parking"
  | "other";

/**
 * Category hints, most specific first. FBO and handler names sit in
 * `fuel` because that is what their invoices overwhelmingly are for a
 * contract pilot — fuel, ramp, GPU, lav service — and the pilot can
 * change it in one click if a given invoice was something else.
 *
 * Deliberately NOT exhaustive and deliberately not scraped from anywhere:
 * these are the names common enough that missing them would read as the
 * software not knowing aviation. Anything unmatched returns null rather
 * than a guess.
 */
const CATEGORY_HINTS: ReadonlyArray<readonly [ExpenseCategory, readonly string[]]> = [
  [
    "fuel",
    [
      "signature flight", "signature aviation", "atlantic aviation", "sheltair",
      "million air", "ross aviation", "jet aviation", "modern aviation",
      "wilson air", "cutter aviation", "clay lacy", "banyan air", "fbo",
      "avfuel", "world fuel", "titan aviation", "phillips 66 aviation",
      "jet a", "jeta", "100ll", "avgas", "ramp fee", "handling fee",
      "into-plane", "uplift",
    ],
  ],
  [
    "hotel",
    ["hotel", "inn", "suites", "marriott", "hilton", "hyatt", "sheraton",
     "westin", "courtyard", "residence inn", "hampton", "holiday inn",
     "doubletree", "embassy suites", "folio", "room charge", "resort fee",
     "lodging", "night(s)", "check-in", "check out"],
  ],
  [
    "rental_car",
    ["hertz", "avis", "enterprise", "national car", "budget rent",
     "alamo", "sixt", "dollar rent", "thrifty", "rental agreement",
     "vehicle rental", "car rental"],
  ],
  ["rideshare", ["uber", "lyft", "taxi", "cab co", "curb ", "ride fare"]],
  [
    "airline",
    ["delta air", "united air", "american airlines", "southwest airlines",
     "alaska airlines", "jetblue", "boarding pass", "ticket number",
     "baggage fee", "e-ticket"],
  ],
  [
    "parking",
    ["parking", "park n fly", "airport garage", "valet", "long term lot"],
  ],
  [
    "meals",
    ["restaurant", "cafe", "coffee", "starbucks", "grill", "diner",
     "bar & grill", "catering", "crew meal", "server:", "gratuity", "tip:"],
  ],
];

/** Words that mean "this is the number that left your account". */
const TOTAL_LABELS = [
  "grand total",
  "amount due",
  "balance due",
  "total due",
  "amount charged",
  "total charged",
  "total amount",
  "total payment",
  "total:",
  "total ",
  "charged",
];

/** Labels that look like totals but are NOT what was paid. */
const NOT_A_TOTAL = [
  "subtotal",
  "sub total",
  "estimated total",
  "total gallons",
  "total gal",
  "total qty",
  "total items",
  "previous balance",
  "total savings",
  "total discount",
  "tax total",
  "total tax",
];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d >= 1 && d <= (days[m - 1] ?? 31) && y >= 2000 && y <= 2100;
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * The first date on a receipt that is a real calendar date. Handles the
 * three shapes receipts actually print, including the spelled month that
 * hotel folios favour.
 *
 * US ordering (M/D/Y) is assumed for the all-numeric form, because that is
 * what a US receipt prints and this product is US-only throughout (IRS
 * periods, 14 CFR, USD). An ambiguous 03/04/2026 therefore reads as March
 * 4th — and the pilot sees it in the form before it is saved, which is
 * the whole point of pre-filling rather than filing.
 */
export function extractDate(text: string): string | null {
  const numeric = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/g;
  for (const m of text.matchAll(numeric)) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    if (isValidYmd(year, month, day)) return iso(year, month, day);
  }

  const isoLike = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
  for (const m of text.matchAll(isoLike)) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (isValidYmd(y, mo, d)) return iso(y, mo, d);
  }

  // "Mar 15, 2026" / "15 Mar 2026" / "March 15 2026"
  const spelled = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b|\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/g;
  for (const m of text.matchAll(spelled)) {
    const monthWord = (m[1] ?? m[5] ?? "").slice(0, 3).toLowerCase();
    const day = Number(m[2] ?? m[4]);
    const year = Number(m[3] ?? m[6]);
    const month = MONTHS[monthWord];
    if (month && isValidYmd(year, month, day)) return iso(year, month, day);
  }

  return null;
}

/** "1,234.56" / "1234.56" / "$1,234.56" -> cents, or undefined. */
function moneyToCents(raw: string): number | undefined {
  const cleaned = raw.replace(/[$\s]/g, "").replace(/,/g, "");
  if (!/^\d+\.\d{2}$/.test(cleaned) && !/^\d+$/.test(cleaned)) return undefined;
  const [whole, fraction = ""] = cleaned.split(".");
  if ((whole ?? "").length > 7) return undefined; // a receipt is not $10m
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0") || "0");
}

/**
 * The amount, from a LABELLED total line and nowhere else.
 *
 * When several total-ish lines appear (a folio often prints "Total" per
 * day and once at the end), the LAST one wins — receipts total at the
 * bottom, and the final figure is the one that was charged.
 */
export function extractAmountCents(text: string): number | null {
  const lines = text.split(/\r?\n/);
  let found: number | null = null;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (NOT_A_TOTAL.some((bad) => lower.includes(bad))) continue;
    if (!TOTAL_LABELS.some((label) => lower.includes(label))) continue;

    // The last money-looking token on the line — receipts put the label
    // left and the figure right.
    //
    // The fraction is matched as `\.\d+`, NOT `\.\d{2}`, so a malformed
    // amount is consumed WHOLE and then rejected by moneyToCents. Matching
    // only two decimals let "1,234.5" tokenise as "1,234" and "5", and
    // last-token-wins then returned $5.00 for a $1,234.50 line — a
    // confidently wrong amount, which is the one outcome worse than
    // returning nothing. Caught by its own unit test before it shipped.
    const monies = Array.from(line.matchAll(/\$?\s*\d[\d,]*(?:\.\d+)?/g))
      .map((m) => moneyToCents(m[0]))
      .filter((c): c is number => c !== undefined && c > 0);
    if (monies.length > 0) found = monies[monies.length - 1]!;
  }

  return found;
}

/**
 * The merchant. Taken from the first substantial line of the receipt,
 * which is where every printed receipt puts its own name — not guessed
 * from the body, where an address or a card type would win.
 */
export function extractVendor(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    // The edge of a photographed receipt — the shadow line, the torn
    // perforation, the desk behind it — reliably OCRs as a stray "|", "."
    // or "~" leading or trailing the first line. Observed directly: a
    // browser run over a rotated, noisy render returned
    // "| SYNTHETIC AVIATION SERVICES". Trimmed to the first and last
    // alphanumeric character, which no real merchant name starts or ends
    // outside of.
    const line = raw.trim().replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}.]+$/u, "");
    if (line.length < 3 || line.length > 60) continue;
    // Skip lines that are mostly numbers/punctuation — a header rule, a
    // phone number, a card mask.
    const letters = (line.match(/[A-Za-z]/g) ?? []).length;
    if (letters < line.length * 0.5) continue;
    if (/^(receipt|invoice|customer copy|merchant copy|thank you)\b/i.test(line)) continue;
    return line.replace(/\s{2,}/g, " ").slice(0, 60);
  }
  return null;
}

export function extractCategory(text: string): ExpenseCategory | null {
  const lower = text.toLowerCase();
  for (const [category, hints] of CATEGORY_HINTS) {
    if (hints.some((h) => lower.includes(h))) return category;
  }
  return null;
}

/**
 * A tail number. US N-numbers plus the common foreign shapes a contract
 * pilot sees (C-, G-, M-, VP-, N reg with a hyphen). Anchored on word
 * boundaries so an invoice number like "INV-N12345" doesn't match.
 */
export function extractAircraftIdent(text: string): string | null {
  const patterns = [
    /\bN[1-9]\d{0,4}[A-Z]{0,2}\b/g, // US: N123AB, N9, N12345
    /\b(?:C|G|M|VH|ZK|VP-[A-Z]|HB|OE|D)-[A-Z]{2,5}\b/g,
  ];
  for (const re of patterns) {
    for (const m of text.toUpperCase().matchAll(re)) {
      const candidate = m[0];
      // "NOTE", "NOV" etc. are not tail numbers; a real N-number has a
      // digit right after the N.
      if (/^N/.test(candidate) && !/^N\d/.test(candidate)) continue;
      return candidate;
    }
  }
  return null;
}

/** ICAO (KTEB) or IATA (TEB) identifiers, deduped, in order of appearance. */
export function extractAirportIdents(text: string): string[] {
  const found: string[] = [];
  for (const m of text.toUpperCase().matchAll(/\b[K][A-Z]{3}\b/g)) {
    if (!found.includes(m[0])) found.push(m[0]);
  }
  return found.slice(0, 4);
}

/** Fuel uplift, when the receipt states gallons. */
export function extractGallons(text: string): number | null {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(?:gal|gallons|gals)\b/i.exec(text);
  if (!m) return null;
  const parsed = parseTenth((m[1] ?? "").replace(/,/g, ""), { max: 99999 });
  return typeof parsed === "number" ? parsed : null;
}

/**
 * Below this mean OCR confidence, the vendor is dropped.
 *
 * Date, amount and category defend themselves: a date has to be a real
 * calendar date, an amount has to match a money shape on a labelled total
 * line, a category has to match a known name. Garbage fails all three and
 * comes back null on its own. The VENDOR has no such shape — it is
 * whatever the first substantial line said — so on a genuinely bad read it
 * is the one field that happily returns noise. A browser run over a
 * heavily degraded photo returned mean confidence 10 and a vendor of
 * "RE a ee CR PEE ele Ep 6 TR", which the pilot would then have to notice
 * and delete. Better to hand back nothing and say the photo was too poor.
 *
 * Set well below the threshold at which the UI merely WARNS: this is the
 * point where the text is not words at all, not the point where it is
 * merely doubtful.
 */
const VENDOR_CONFIDENCE_FLOOR = 40;

export function extractReceipt(
  text: string,
  options: { confidence?: number } = {}
): ReceiptExtraction {
  const date = extractDate(text);
  const amountCents = extractAmountCents(text);
  const legible =
    options.confidence === undefined || options.confidence >= VENDOR_CONFIDENCE_FLOOR;
  const vendor = legible ? extractVendor(text) : null;
  const category = extractCategory(text);

  const filled: ReceiptExtraction["filled"] = [];
  if (date) filled.push("date");
  if (amountCents !== null) filled.push("amount");
  if (vendor) filled.push("vendor");
  if (category) filled.push("category");

  return {
    date,
    amountCents,
    vendor,
    category,
    aircraftIdent: extractAircraftIdent(text),
    airportIdents: extractAirportIdents(text),
    gallons: extractGallons(text),
    filled,
  };
}
