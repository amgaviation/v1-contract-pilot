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
  | "training"
  | "medical"
  | "insurance"
  | "charts"
  | "equipment"
  | "uniform"
  | "dues"
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
    "training",
    ["flightsafety", "cae training", "simcom", "recurrent training", "type rating",
     "initial training", "simulator", "checkride", "proficiency check",
     "ground school"],
  ],
  [
    "medical",
    // NOT "ame " — hints are plain substring matches, and "ame " matches
    // "NAME " on essentially every receipt ever printed. Caught by a test
    // before it shipped. Every hint here has to survive being read as a
    // substring of ordinary English.
    ["aviation medical examiner", "faa medical", "first class medical",
     "second class medical", "third class medical", "flight physical",
     "airman medical"],
  ],
  [
    "charts",
    ["foreflight", "jeppesen", "garmin pilot", "navigraph", "chart subscription",
     "efb subscription"],
  ],
  [
    "dues",
    ["nbaa", "aopa", "eaa", "alpa", "association dues", "membership dues"],
  ],
  [
    "equipment",
    ["bose a20", "bose a30", "lightspeed zulu", "david clark", "headset",
     "flight bag", "kneeboard"],
  ],
  [
    "meals",
    // "dinner"/"lunch"/"breakfast" are only safe to list now that hints
    // match on word boundaries — as bare substrings, "dinner" would have
    // been shadowed by the hotel list's "inn" matching inside it, which is
    // the defect that prompted this. A crew meal receipt that says nothing
    // but DINNER used to come back as a hotel and now comes back as meals.
    ["restaurant", "cafe", "coffee", "starbucks", "grill", "diner",
     "bar & grill", "catering", "crew meal", "server:", "gratuity", "tip:",
     "breakfast", "lunch", "dinner"],
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

/**
 * What a dollar figure has to look like to be read as one.
 *
 * ***************************************************************************
 * WHY CENTS ARE MANDATORY, EVEN THOUGH REAL RECEIPTS PRINT "TOTAL 125"
 * ***************************************************************************
 * This used to accept a bare integer as whole dollars, and combined with
 * "last money token on the line wins" that produced the single worst class
 * of bug this product can have — a confidently wrong amount, on the exact
 * lines a real receipt prints. Every one of these was reproduced against
 * the module before this rewrite:
 *
 *     TOTAL DUE $3,371.90  INV 884213        ->  $884,213.00
 *     TOTAL DUE $3,371.90  VISA 4242         ->    $4,242.00
 *     Total $61.50  Auth 004532              ->    $4,532.00
 *     TOTAL DUE 3,371.90 on 03/15/26         ->       $26.00
 *     TOTAL PETROLEUM PLAZA, 1200 AIRPORT RD ->    $1,200.00
 *     Total Nights 3                         ->        $3.00
 *
 * Tesseract routinely merges the columns of a multi-column receipt onto
 * one line, so an invoice number, a card mask or an auth code sitting to
 * the right of the total is the normal case, not a corner case. Requiring
 * an explicit two-decimal fraction disqualifies all of them, because none
 * of those trailing numbers is written with cents.
 *
 * The cost is real and accepted: a receipt that genuinely prints "TOTAL
 * 125" now returns nothing and the pilot types 125. That is the trade this
 * whole module is built on — nothing gets typed, wrong gets confirmed.
 *
 * It also disposes of European formats for free. "1.234,56" and
 * "1 240,55" produce no match at all rather than $56.00 and $24,055.00,
 * which is what they used to return.
 *
 * The lookarounds matter: without them "1,234.567" would match the
 * "1,234.56" prefix and silently drop a digit.
 */
const MONEY = /(?<![\d.,])(-?)\(?\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})\s*(\)?)(?![\d.])/g;

/** Currencies this product cannot represent. The field is labelled USD. */
const NOT_USD = /\b(?:EUR|GBP|CAD|AUD|NZD|CHF|JPY|MXN|SEK|NOK|DKK)\b|[€£¥₹]|\b[CA]\$/i;

/** Lines whose figure is money going the other way. */
const MONEY_BACK = /\b(?:refund|credit|change due|amount returned|reversal)\b/i;

/** A strictly-shaped dollar figure -> integer cents, or undefined. */
function moneyToCents(whole: string, fraction: string): number | undefined {
  const digits = whole.replace(/,/g, "");
  if (digits.length > 7) return undefined; // a receipt is not $10m
  return Number(digits) * 100 + Number(fraction);
}

/**
 * The amount, from a LABELLED total line and nowhere else.
 *
 * When several total-ish lines appear (a folio prints "Total" per day and
 * once at the end), the LAST one wins — receipts total at the bottom, and
 * the final figure is the one that was charged.
 *
 * Three refusals, each of which used to be a wrong number:
 *
 *   - TWO DIFFERENT FIGURES ON ONE TOTAL LINE is ambiguous, not a race to
 *     be won by whichever is further right. A merged "Total 61.50 Tip
 *     12.00" has no single answer and gets none.
 *   - A NEGATIVE OR PARENTHESISED TOTAL is a credit memo, and an FBO does
 *     issue those for a mis-billed uplift. Read as a positive expense it
 *     would be attached to a trip and rebilled to a client — the client
 *     invoiced for their own refund. Refused outright rather than turned
 *     into a negative expense, which the schema does not accept either.
 *   - A NON-USD FIGURE is not this field. "TOTAL CAD 1,240.55" used to
 *     store $1,240.55.
 *
 * Zero is a real answer and is kept — but only when it is the ONLY
 * answer. A direct-billed folio ends "BALANCE DUE 0.00" with nothing else
 * labelled, and reading that as zero is right: the operator paid it, and
 * discarding it used to fall back to a mid-stay "Total 189.00" line, a
 * room charge offered to the pilot to rebill.
 *
 * A SETTLED folio is a different document and used to give the same
 * answer for the wrong reason:
 *
 *     TOTAL CHARGES        648.42
 *     PAYMENT VISA 4242   -648.42
 *     BALANCE DUE            0.00
 *
 * Last-labelled-total-wins made that $0.00, and the expense form
 * pre-filled 0.00 for a stay that cost $648.42. So a zero is refused when
 * a non-zero labelled total appeared earlier on the same receipt — the
 * two readings ("nothing to pay" and "already paid, this is what it
 * cost") are genuinely different expenses, and this module does not
 * choose between them. Null, and the pilot types it.
 */
export function extractAmountCents(text: string): number | null {
  let found: number | null = null;
  let sawNonZeroTotal = false;

  for (const line of text.split(/\r?\n/)) {
    const lower = line.toLowerCase();
    // Tested against the whole line, so a merged "Subtotal 100.00  Total
    // 125.00" is skipped entirely. That loses a readable total, and does
    // so in the safe direction — null, not a guess.
    if (NOT_A_TOTAL.some((bad) => lower.includes(bad))) continue;
    if (!TOTAL_LABELS.some((label) => lower.includes(label))) continue;
    if (NOT_USD.test(line) || MONEY_BACK.test(line)) return null;

    const candidates: number[] = [];
    let negative = false;
    for (const match of line.matchAll(MONEY)) {
      const [, sign, whole, fraction, close] = match;
      const cents = moneyToCents(whole ?? "", fraction ?? "");
      if (cents === undefined) continue;
      if (sign === "-" || close === ")") negative = true;
      candidates.push(cents);
    }

    if (negative) return null;
    const distinct = Array.from(new Set(candidates));
    if (distinct.length === 1) found = distinct[0]!;
    else if (distinct.length > 1) return null;

    if (found !== null && found > 0) sawNonZeroTotal = true;
  }

  // See the header: a trailing zero after a real total is a BALANCE, not
  // an amount. Refusing beats offering either number, because which one is
  // the pilot's expense depends on who settled it.
  if (found === 0 && sawNonZeroTotal) return null;

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
    const trimmed = raw.trim();
    // Bound the input to the two anchored strips below before running
    // them. An end-anchored `[^X]+$` backtracks quadratically over a long
    // run of class members, and while OCR line length is bounded in
    // practice by the canvas width, that is a property of the current
    // caller rather than of this function. No receipt header is 200
    // characters; a line that long is a table row or a scan artifact.
    if (trimmed.length > 200) continue;
    const line = trimmed.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}.]+$/u, "");
    if (line.length < 3 || line.length > 60) continue;
    // Skip lines that are mostly numbers/punctuation — a header rule, a
    // phone number, a card mask. Measured against NON-SPACE characters:
    // counting spaces in the denominator let "TOTAL DUE 100.00" through at
    // 8 letters of 16 characters, and it was returned as the merchant.
    const dense = line.replace(/\s/g, "");
    const letters = (dense.match(/[A-Za-z]/g) ?? []).length;
    if (letters < dense.length * 0.5) continue;
    if (/^(receipt|invoice|customer copy|merchant copy|thank you)\b/i.test(line)) continue;
    // A street number leading the line means this is the address block,
    // not the name — "1200 AIRPORT RD" was being returned as the vendor of
    // a receipt whose next line said SYNTHETIC FBO.
    if (/^\d+\s+\p{L}/u.test(line)) continue;
    // And a total line is never the merchant, however word-like it looks.
    const lower = line.toLowerCase();
    if (TOTAL_LABELS.some((label) => lower.includes(label))) continue;
    return line.replace(/\s{2,}/g, " ").slice(0, 60);
  }
  return null;
}

/**
 * Hints match on WORD BOUNDARIES, not as bare substrings.
 *
 * A plain `includes` made every receipt containing the word DINNER a
 * hotel, because "inn" is one of the hotel hints — and the meals category
 * it should have landed in is the single most common expense a contract
 * pilot files. This repo has been bitten by exactly this before: "ame " as
 * a medical hint matched "NAME " on every receipt that printed one.
 *
 * Multi-word hints ("holiday inn", "rental car") keep working because \b
 * sits at each end of the whole phrase, not between its words.
 */
const HINT_CACHE = new Map<string, RegExp>();
function hintMatches(haystack: string, hint: string): boolean {
  let re = HINT_CACHE.get(hint);
  if (!re) {
    const escaped = hint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // \b is only meaningful next to a word character. A hint that starts
    // or ends with punctuation ("$", "#") falls back to a plain search on
    // that side rather than a boundary that can never match.
    const left = /^\w/.test(hint) ? "\\b" : "";
    const right = /\w$/.test(hint) ? "\\b" : "";
    re = new RegExp(`${left}${escaped}${right}`, "i");
    HINT_CACHE.set(hint, re);
  }
  return re.test(haystack);
}

export function extractCategory(text: string): ExpenseCategory | null {
  for (const [category, hints] of CATEGORY_HINTS) {
    if (hints.some((h) => hintMatches(text, h))) return category;
  }
  return null;
}

/**
 * A tail number. US N-numbers plus the common foreign shapes a contract
 * pilot sees (C-, G-, M-, VP-, N reg with a hyphen). Anchored on word
 * boundaries so an invoice number like "INV-N12345" doesn't match.
 */
export function extractAircraftIdent(text: string): string | null {
  const upper = text.toUpperCase();
  // Words that mean "the thing after this is an aircraft". A short or
  // foreign-shaped candidate is only believed when one of these is on the
  // same line — see WEAK below.
  const CONTEXT = /\b(?:AIRCRAFT|TAIL|REG|REGISTRATION|A\/C|SHIP|N-?NUMBER)\b/;

  for (const line of upper.split(/\r?\n/)) {
    const hasContext = CONTEXT.test(line);

    // A full US N-number: N plus at least two more characters. Common
    // enough in shape that it can stand on its own anywhere on the page.
    for (const m of line.matchAll(/\bN[1-9]\d{0,4}[A-Z]{0,2}\b/g)) {
      const candidate = m[0]!;
      // WEAK: "N2", "N4". Legal registrations, and also what "PUMP N2
      // SELECTED" and "ROOM N4" look like — which is what a fuel desk
      // receipt and a hotel folio actually print. Believed only in
      // context.
      if (candidate.length < 3 && !hasContext) continue;
      return candidate;
    }

    // Foreign registrations are a letter-hyphen-letters shape that ordinary
    // English hits constantly: C-STORE, G-FORCE, M-CLASS, D-RATE were all
    // being reported to the pilot as their aircraft. Context required.
    if (!hasContext) continue;
    for (const m of line.matchAll(/\b(?:C|G|M|VH|ZK|VP-[A-Z]|HB|OE|D)-[A-Z]{2,5}\b/g)) {
      return m[0]!;
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
