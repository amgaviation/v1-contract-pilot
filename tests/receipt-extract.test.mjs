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
