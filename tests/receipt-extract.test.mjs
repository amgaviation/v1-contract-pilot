import test from "node:test";
import assert from "node:assert/strict";

const {
  extractReceipt,
  extractAmountCents,
  extractDate,
  extractAircraftIdent,
  extractVendor,
} = await import("../lib/receipt-ocr/extract.ts");

/**
 * Receipt extraction. Every fixture is synthetic text of the shape a
 * contract pilot's receipts actually take — never a real receipt, and
 * never live pilot data.
 *
 * The governing rule under test: a field this cannot read confidently
 * comes back NULL and the pilot types it. Nothing gets typed; wrong gets
 * confirmed.
 */

const FBO_FUEL = `SYNTHETIC AVIATION SERVICES
KTEB — Teterboro
Invoice 884213      03/15/2026

Aircraft: N447SP        Trip: 1188
Jet A                 412.6 GAL @ $6.85      2,826.31
Ramp Fee                                        250.00
GPU                                              75.00
Subtotal                                      3,151.31
Sales Tax                                       220.59
TOTAL DUE                                    $3,371.90
`;

const HOTEL_FOLIO = `SYNTHETIC INN & SUITES
1200 Airport Rd

Folio 55219
Check-in  Mar 12, 2026
Check out Mar 15, 2026

03/12  Room Charge            189.00
03/12  Resort Fee              25.00
03/13  Room Charge            189.00
03/13  Total                  403.00
03/14  Room Charge            189.00
Subtotal                      592.00
Occupancy Tax                  71.04
BALANCE DUE                  $663.04
`;

const RIDESHARE = `Uber
Trip receipt
March 15, 2026

Pickup  KTEB
Dropoff Manhattan
Fare                 58.40
Booking Fee           3.10
Total               $61.50
`;

test("an FBO fuel invoice reads as fuel, with the labelled total", async (t) => {
  const r = extractReceipt(FBO_FUEL);

  await t.test("the amount comes from TOTAL DUE, not the biggest number", () => {
    // 412.6 GAL and 2,826.31 both appear before it. Taking the largest
    // number, or the first, would both be wrong.
    assert.equal(r.amountCents, 337190);
  });

  await t.test("the category knows what an FBO is", () => {
    // A pilot seeing "Other" for a Jet A invoice would conclude the
    // software doesn't know their world.
    assert.equal(r.category, "fuel");
  });

  await t.test("date, tail number, airport and uplift are all captured", () => {
    assert.equal(r.date, "2026-03-15");
    assert.equal(r.aircraftIdent, "N447SP");
    assert.deepEqual(r.airportIdents, ["KTEB"]);
    assert.equal(r.gallons, 412.6);
  });

  await t.test("the vendor is the receipt's own header line", () => {
    assert.equal(r.vendor, "SYNTHETIC AVIATION SERVICES");
  });
});

test("a hotel folio takes the FINAL balance, not a running daily total", () => {
  // Folios print "Total" per day. The mid-stay 403.00 line is a running
  // balance and taking the first labelled total would understate the bill
  // by $260.
  const r = extractReceipt(HOTEL_FOLIO);
  assert.equal(r.amountCents, 66304);
  assert.equal(r.category, "hotel");
  assert.equal(r.date, "2026-03-12", "the first real date on the folio");
});

test("a rideshare receipt reads with a spelled month", () => {
  const r = extractReceipt(RIDESHARE);
  assert.equal(r.amountCents, 6150);
  assert.equal(r.category, "rideshare");
  assert.equal(r.date, "2026-03-15");
});

test("subtotal and gallon lines are never mistaken for the total", async (t) => {
  await t.test("subtotal is excluded", () => {
    assert.equal(extractAmountCents("Subtotal 100.00\nTOTAL 125.00"), 12500);
  });

  await t.test("'total gallons' is not money", () => {
    // The trap that makes "largest number wins" dangerous on a fuel
    // invoice: an uplift can exceed the dollar total on a small purchase.
    assert.equal(extractAmountCents("Total Gallons 850.4\nTotal Due 620.15"), 62015);
  });

  await t.test("an estimated total is not what was charged", () => {
    assert.equal(extractAmountCents("Estimated Total 400.00\nAmount Charged 312.88"), 31288);
  });
});

test("a second number on the total line never becomes the amount", async (t) => {
  // Every case below RETURNED THE WRONG DOLLAR FIGURE before the amount
  // rule required explicit cents — the worst class of defect this product
  // has, and one a green test suite missed entirely because every fixture
  // here used to have exactly one number on its total line.
  //
  // Tesseract merges the columns of a multi-column receipt onto one line,
  // so an invoice number, a card mask or an auth code to the right of the
  // total is the normal case, not a corner case.
  await t.test("an invoice number to the right of the total (was $884,213.00)", () => {
    assert.equal(extractAmountCents("TOTAL DUE $3,371.90  INV 884213"), 337190);
  });

  await t.test("a card mask (was $4,242.00)", () => {
    assert.equal(extractAmountCents("TOTAL DUE   $3,371.90   VISA 4242"), 337190);
  });

  await t.test("an auth code (was $4,532.00)", () => {
    assert.equal(extractAmountCents("Total  $61.50  Auth 004532"), 6150);
  });

  await t.test("a date on the total line (was $26.00)", () => {
    assert.equal(extractAmountCents("TOTAL DUE 3,371.90 on 03/15/26"), 337190);
  });

  await t.test("a business whose NAME begins with Total (was $1,200.00)", () => {
    assert.equal(extractAmountCents("TOTAL PETROLEUM PLAZA, 1200 AIRPORT RD"), null);
  });

  await t.test("a count, not money (was $3.00)", () => {
    assert.equal(extractAmountCents("Total Nights 3"), null);
    assert.equal(extractAmountCents("Total Rewards # 998877"), null);
  });

  await t.test("two different figures on one line is ambiguous, not a race", () => {
    // A merged "Total 61.50 Tip 12.00" has no single right answer.
    assert.equal(extractAmountCents("Total  61.50   Tip 12.00"), null);
    // The same figure twice — a duplicated column — is not ambiguous.
    assert.equal(extractAmountCents("TOTAL DUE   3,371.90    3,371.90"), 337190);
  });

  await t.test("a whole-dollar total is refused rather than guessed at", () => {
    // The accepted cost of the rule above: "TOTAL 125" is a real thing a
    // receipt prints, and the pilot now types it. Accepting bare integers
    // is what produced every failure in this block.
    assert.equal(extractAmountCents("TOTAL 125"), null);
  });
});

test("a credit memo is never read as money the pilot spent", async (t) => {
  // An FBO issues a credit for a mis-billed uplift. Read as a positive
  // expense, it gets attached to a trip by the tail number and flipped to
  // "rebill" by the client's default treatment — and the client is
  // invoiced for their own refund.
  await t.test("a minus sign is not punctuation to be stripped", () => {
    assert.equal(extractAmountCents("TOTAL DUE  -125.00"), null);
    assert.equal(extractAmountCents("AMOUNT CHARGED -3,371.90"), null);
  });

  await t.test("nor are accounting parentheses", () => {
    assert.equal(extractAmountCents("Total  ($125.00)"), null);
  });

  await t.test("and the words are honoured too", () => {
    assert.equal(extractAmountCents("Total Refund  250.00"), null);
    assert.equal(extractAmountCents("Change Due  20.00"), null);
  });
});

test("a zero balance is an answer, not a missing one", () => {
  // Direct-billed hotel: the operator paid the room, the folio ends at
  // 0.00. Discarding the zero used to fall back to the mid-stay running
  // total and offer the pilot a $189.00 room charge to rebill.
  assert.equal(
    extractAmountCents("03/13  Room Charge  189.00\n03/13  Total  189.00\nBALANCE DUE  0.00"),
    0
  );
});

test("a total in another currency is not a dollar figure", () => {
  // The field is labelled USD and every figure in this product is USD
  // cents. These used to store the number as if it were dollars.
  assert.equal(extractAmountCents("TOTAL CAD 1,240.55"), null);
  assert.equal(extractAmountCents("TOTAL €61.50"), null);
  assert.equal(extractAmountCents("Total £48.20"), null);
  // European decimal notation is refused by the cents rule itself: these
  // used to return $56.00 and $24,055.00.
  assert.equal(extractAmountCents("Total 1.234,56"), null);
  assert.equal(extractAmountCents("TOTAL 1 240,55"), null);
});

test("an unreadable field comes back null rather than guessed", async (t) => {
  await t.test("no labelled total means no amount", () => {
    // A smeared thermal receipt where the total line didn't survive OCR.
    // Better the pilot types one number than confirms a wrong one.
    assert.equal(extractAmountCents("SYNTHETIC CAFE\n12.40\n3.10\n15.50"), null);
  });

  await t.test("no date means no date", () => {
    assert.equal(extractDate("SYNTHETIC CAFE\nThank you"), null);
  });

  await t.test("an impossible date is not accepted", () => {
    assert.equal(extractDate("Date: 02/30/2026"), null);
    assert.equal(extractDate("Date: 13/01/2026"), null);
  });

  await t.test("nothing recognisable means no category", () => {
    const r = extractReceipt("SYNTHETIC WIDGET CO\nTotal 40.00");
    assert.equal(r.category, null);
    assert.deepEqual(r.filled, ["amount", "vendor"], "and it reports what it did fill");
  });
});

test("a tail number is recognised but an invoice number is not", async (t) => {
  await t.test("US and foreign registrations", () => {
    assert.equal(extractAircraftIdent("Aircraft N447SP"), "N447SP");
    assert.equal(extractAircraftIdent("Reg: N9"), "N9");
    assert.equal(extractAircraftIdent("Aircraft C-GABC"), "C-GABC");
  });

  await t.test("a word starting with N is not a tail number", () => {
    // "NOTE", "NOV" and friends. A real N-number has a digit after the N.
    assert.equal(extractAircraftIdent("NOTE: crew of two"), null);
    assert.equal(extractAircraftIdent("NOVEMBER STATEMENT"), null);
  });

  await t.test("ordinary English is not a foreign registration", () => {
    // These were all reported to the pilot as their aircraft. A
    // letter-hyphen-letters shape is far too common in English to believe
    // on its own, so the foreign pattern now needs an aircraft word on the
    // same line.
    assert.equal(extractAircraftIdent("C-STORE PURCHASE"), null);
    assert.equal(extractAircraftIdent("G-FORCE FITNESS"), null);
    assert.equal(extractAircraftIdent("M-CLASS SUITE"), null);
    assert.equal(extractAircraftIdent("D-RATE applied"), null);
    assert.equal(extractAircraftIdent("Aircraft C-GABC"), "C-GABC", "with context, still read");
  });

  await t.test("a one-digit N-number needs context, because a fuel desk prints those", () => {
    assert.equal(extractAircraftIdent("PUMP N2 SELECTED"), null);
    assert.equal(extractAircraftIdent("ROOM N4"), null);
    assert.equal(extractAircraftIdent("Tail N2"), "N2", "N2 is a real registration");
  });
});

test("the costs a pilot self-funds get their own category, not Other", async (t) => {
  // Recurrent training is commonly a freelance pilot's single largest
  // annual deduction, and every one of these used to land in "other" —
  // which the year-end report then grouped under that name, so the biggest
  // line on the report handed to an accountant read "Other".
  await t.test("the ones that matter most", () => {
    assert.equal(extractReceipt("FLIGHTSAFETY INTERNATIONAL\nRecurrent training\nTotal 18,500.00").category, "training");
    assert.equal(extractReceipt("ForeFlight\nPerformance Plus annual\nTotal 299.99").category, "charts");
    assert.equal(extractReceipt("NBAA\nMembership dues 2026\nTotal 495.00").category, "dues");
    assert.equal(extractReceipt("Aviation Medical Examiner\nFirst class medical\nTotal 175.00").category, "medical");
  });

  await t.test("a hint must survive being read as a substring of ordinary English", () => {
    // "ame " was in the medical list for about a minute. Hints are plain
    // substring matches, so it fired on "NAME: JOHN SMITH" — which is on
    // essentially every receipt ever printed.
    assert.equal(extractReceipt("SYNTHETIC WIDGET CO\nNAME: JOHN SMITH\nTotal 12.00").category, null);
    assert.equal(extractReceipt("PANCAKE HOUSE\nTotal 18.00").category, null);
    // And the hint that IS legitimate still fires: "SYNTHETIC CAFE" is a
    // meal, and this fixture originally used it by mistake — the test was
    // wrong, not the code.
    assert.equal(extractReceipt("SYNTHETIC CAFE\nTotal 12.00").category, "meals");
  });
});

test("the vendor survives the edge of a photographed receipt", async (t) => {
  // Observed in a real browser run of the engine over a rotated, noisy
  // render: the shadow at the edge of the paper OCRs as a leading pipe,
  // and it went straight into the vendor field.
  await t.test("stray marks either side are trimmed", () => {
    assert.equal(extractVendor("| SYNTHETIC AVIATION SERVICES ~"), "SYNTHETIC AVIATION SERVICES");
    assert.equal(extractVendor(". SYNTHETIC INN & SUITES"), "SYNTHETIC INN & SUITES");
  });

  await t.test("punctuation a merchant actually uses is kept", () => {
    assert.equal(extractVendor("SYNTHETIC AVIATION CO."), "SYNTHETIC AVIATION CO.");
    assert.equal(extractVendor("SYNTHETIC AIR & JET CENTER"), "SYNTHETIC AIR & JET CENTER");
  });

  await t.test("a line that is only noise is skipped, not returned trimmed to nothing", () => {
    assert.equal(extractVendor("~~ | ~~\nSYNTHETIC FBO"), "SYNTHETIC FBO");
  });

  await t.test("the address block is not the merchant", () => {
    // "1200 AIRPORT RD" was returned as the vendor of a receipt whose very
    // next line said SYNTHETIC FBO.
    assert.equal(extractVendor("1200 AIRPORT RD\nSYNTHETIC FBO"), "SYNTHETIC FBO");
  });

  await t.test("a total line is not the merchant either", () => {
    // It passed the letter-ratio test at 8 letters of 16 CHARACTERS —
    // spaces were counted in the denominator. Measured on non-space
    // characters it fails, and the label check refuses it outright.
    assert.equal(extractVendor("\n\nTOTAL DUE 100.00"), null);
  });
});

test("a read too poor to be words fills nothing in", async (t) => {
  // Measured, not imagined: a browser run over a heavily degraded photo
  // came back at mean confidence 10 with a vendor of "RE a ee CR PEE ele
  // Ep 6 TR". Date and amount had already refused themselves — only the
  // shapeless field needed a floor.
  const noise = "RE a ee CR PEE ele Ep 6 TR\nTNTHET 7, ie";

  await t.test("the vendor is dropped when confidence says it is not text", () => {
    assert.equal(extractReceipt(noise, { confidence: 10 }).vendor, null);
    assert.deepEqual(extractReceipt(noise, { confidence: 10 }).filled, []);
  });

  await t.test("a merely doubtful read still fills it — the UI warns instead", () => {
    assert.equal(extractReceipt("SYNTHETIC FBO\nTotal 40.00", { confidence: 55 }).vendor, "SYNTHETIC FBO");
  });

  await t.test("no confidence supplied means no gate", () => {
    assert.equal(extractReceipt("SYNTHETIC FBO\nTotal 40.00").vendor, "SYNTHETIC FBO");
  });
});

test("the money parser refuses shapes that are not money", () => {
  assert.equal(extractAmountCents("Total 1,234.5"), null, "one decimal is not cents");
  assert.equal(extractAmountCents("Total ABC"), null);
  assert.equal(extractAmountCents("Total 99999999.00"), null, "a receipt is not $100m");
});
