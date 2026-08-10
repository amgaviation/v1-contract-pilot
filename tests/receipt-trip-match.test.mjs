import test from "node:test";
import assert from "node:assert/strict";

const { matchTrip } = await import("../lib/receipt-ocr/match-trip.ts");

/**
 * Matching a scanned receipt to the trip it belongs to. Every trip below is
 * synthetic — no live pilot data, ever.
 *
 * The stake here is money, not convenience: the trip a receipt lands on is
 * what decides whether it gets rebilled to a client or absorbed. So the
 * behaviour under test is as much about what this REFUSES to decide as
 * what it decides.
 */

const trip = (id, aircraftIdent, startsOn, endsOn) => ({
  id,
  label: id,
  aircraftIdent,
  startsOn,
  endsOn,
});

const TETERBORO = trip("teterboro", "N447SP", "2026-03-14", "2026-03-16");
const AUGUST = trip("august", "N447SP", "2026-08-02", "2026-08-05");
const OTHER_SHIP = trip("other-ship", "N91TC", "2026-03-15", "2026-03-15");

test("a tail number on the receipt is what finds the trip", async (t) => {
  await t.test("one trip flew it, so there is nothing to disambiguate", () => {
    const m = matchTrip([TETERBORO, OTHER_SHIP], {
      aircraftIdent: "N447SP",
      date: "2026-03-15",
    });
    assert.equal(m.kind, "one");
    assert.equal(m.trip.id, "teterboro");
  });

  await t.test("the date separates two trips on the same aircraft", () => {
    const m = matchTrip([TETERBORO, AUGUST], {
      aircraftIdent: "N447SP",
      date: "2026-08-03",
    });
    assert.equal(m.kind, "one");
    assert.equal(m.trip.id, "august");
  });

  await t.test("punctuation and case are not identity", () => {
    // An FBO's billing system writes "N-447SP"; the pilot typed "n447sp".
    // Same aircraft.
    const m = matchTrip([trip("t", "n447sp", "2026-03-14", "2026-03-16")], {
      aircraftIdent: "N-447SP",
      date: "2026-03-15",
    });
    assert.equal(m.kind, "one");
  });
});

test("a day either side of the trip still counts as during it", async (t) => {
  // The fuel uplift on the morning of departure and the hotel folio settled
  // the day after the last leg are the two receipts a pilot most wants
  // attached, and both fall outside the logged range.
  await t.test("the day before departure", () => {
    const m = matchTrip([TETERBORO, AUGUST], { aircraftIdent: "N447SP", date: "2026-03-13" });
    assert.equal(m.kind, "one");
    assert.equal(m.trip.id, "teterboro");
  });

  await t.test("the day after the last leg", () => {
    const m = matchTrip([TETERBORO, AUGUST], { aircraftIdent: "N447SP", date: "2026-03-17" });
    assert.equal(m.kind, "one");
  });

  await t.test("a month away is not the same trip", () => {
    const m = matchTrip([TETERBORO, AUGUST], { aircraftIdent: "N447SP", date: "2026-05-01" });
    assert.equal(m.kind, "several", "it flew that tail, but not then — the pilot picks");
    assert.equal(m.trips.length, 2);
  });

  await t.test("the window crosses a month boundary without arithmetic drift", () => {
    const july = trip("july", "N447SP", "2026-07-30", "2026-07-31");
    const m = matchTrip([july], { aircraftIdent: "N447SP", date: "2026-08-01" });
    assert.equal(m.kind, "one");
  });
});

test("one candidate is still checked against the date", async (t) => {
  // THE REGRESSION THIS BLOCK EXISTS FOR. The single-candidate branch used
  // to return before the date window was consulted, which made the window
  // effectively infinite in exactly the common case — a contract pilot
  // usually has ONE logged trip per tail, not two. A March trip in N447SP
  // took an August receipt, auto-selected the trip, and through the
  // client's default treatment flipped it to "rebill": a client invoiced
  // for a charge from five months outside their trip.
  await t.test("a receipt months outside the only trip is not that trip", () => {
    const m = matchTrip([TETERBORO], { aircraftIdent: "N447SP", date: "2026-08-09" });
    assert.equal(m.kind, "several");
    assert.match(m.because, /but not on 2026-08-09/);
  });

  await t.test("nor is one from before the pilot ever flew it", () => {
    assert.equal(
      matchTrip([TETERBORO], { aircraftIdent: "N447SP", date: "2025-01-01" }).kind,
      "several"
    );
  });

  await t.test("in period, one candidate is still matched", () => {
    const m = matchTrip([TETERBORO], { aircraftIdent: "N447SP", date: "2026-03-15" });
    assert.equal(m.kind, "one");
  });

  await t.test("no date at all: offered, but the missing evidence is said out loud", () => {
    const m = matchTrip([TETERBORO], { aircraftIdent: "N447SP", date: null });
    assert.equal(m.kind, "one", "one candidate is still the only candidate");
    assert.match(m.because, /couldn't read a date/);
  });
});

test("it refuses to guess rather than attaching a charge to the wrong trip", async (t) => {
  await t.test("two trips on the same aircraft in the same window", () => {
    const a = trip("a", "N447SP", "2026-03-14", "2026-03-16");
    const b = trip("b", "N447SP", "2026-03-16", "2026-03-18");
    const m = matchTrip([a, b], { aircraftIdent: "N447SP", date: "2026-03-16" });
    assert.equal(m.kind, "several");
    assert.equal(m.trips.length, 2);
  });

  await t.test("no date read means every trip on that tail is a candidate", () => {
    const m = matchTrip([TETERBORO, AUGUST], { aircraftIdent: "N447SP", date: null });
    assert.equal(m.kind, "several");
    assert.match(m.because, /couldn't read a date/);
  });

  await t.test("no tail number is no match, however good the date is", () => {
    // Every trip that week would match on date alone, and "you were flying
    // that week" says nothing about a particular hotel bill.
    assert.equal(
      matchTrip([TETERBORO], { aircraftIdent: null, date: "2026-03-15" }).kind,
      "none"
    );
  });

  await t.test("an aircraft the pilot has no trip for is no match", () => {
    assert.equal(
      matchTrip([TETERBORO], { aircraftIdent: "N12345", date: "2026-03-15" }).kind,
      "none"
    );
  });

  await t.test("a trip with no aircraft recorded never matches on a blank", () => {
    const blank = trip("blank", null, "2026-03-14", "2026-03-16");
    assert.equal(
      matchTrip([blank], { aircraftIdent: "N447SP", date: "2026-03-15" }).kind,
      "none"
    );
  });
});
