import test from "node:test";
import assert from "node:assert/strict";

const { safeNextPath } = await import("../lib/safe-next.ts");

/**
 * The post-login redirect target.
 *
 * Three independent security reviewers found the same open redirect here in
 * one session: the guard these call sites used to carry was
 * `startsWith("/") && !startsWith("//")`, which rejects the forward-slash form
 * of a protocol-relative URL and lets a BACKSLASH through. `/\evil.com` passed
 * it, and the browser then resolved the backslash as an authority separator
 * and left the origin.
 *
 * The whole point of these cases is that they fail if anyone reverts to a
 * prefix test. The backslash case is the one that matters; the rest pin the
 * behaviour around it so a future fix cannot pass by breaking the feature.
 */

test("a next= target can only ever be a path on this origin", async (t) => {
  await t.test("the backslash bypass that three reviewers found", () => {
    // The literal defect. A prefix test says "starts with / and not with //"
    // and waves this through; the URL parser reads the backslash as an
    // authority separator and lands on evil.com.
    assert.equal(safeNextPath("/\\evil.com"), "/");
    assert.equal(safeNextPath("/\\\\evil.com"), "/");
    assert.equal(safeNextPath("/\\/evil.com"), "/");
    // Percent-encoded, which is how it arrives in a real query string.
    assert.equal(safeNextPath(decodeURIComponent("/%5Cevil.com")), "/");
  });

  await t.test("the protocol-relative form the old guard did catch", () => {
    assert.equal(safeNextPath("//evil.com"), "/");
    assert.equal(safeNextPath("//evil.com/login"), "/");
  });

  await t.test("absolute URLs, schemes, and userinfo tricks", () => {
    assert.equal(safeNextPath("https://evil.com"), "/");
    assert.equal(safeNextPath("http://evil.com/x"), "/");
    assert.equal(safeNextPath("javascript:alert(1)"), "/");
    assert.equal(safeNextPath("https://placeholder.invalid@evil.com"), "/");
  });

  await t.test("empty, missing and unparseable input falls back to the root", () => {
    assert.equal(safeNextPath(""), "/");
    assert.equal(safeNextPath(null), "/");
    assert.equal(safeNextPath(undefined), "/");
    assert.equal(safeNextPath("not-a-path"), "/");
  });

  await t.test("a real in-app destination still survives, query and fragment intact", () => {
    // Redirecting a pilot back to what they were doing is the feature; a fix
    // that returned "/" for everything would pass the cases above and be
    // useless, so these pin the other side.
    assert.equal(safeNextPath("/"), "/");
    assert.equal(safeNextPath("/overview"), "/overview");
    assert.equal(safeNextPath("/invoices?status=overdue"), "/invoices?status=overdue");
    assert.equal(safeNextPath("/logbook/drafts#pending"), "/logbook/drafts#pending");
    assert.equal(
      safeNextPath("/trips/2f1c9b64-0d5e-4a1f-9c3b-8e7a6d5f4c3b"),
      "/trips/2f1c9b64-0d5e-4a1f-9c3b-8e7a6d5f4c3b"
    );
  });

  await t.test("traversal cannot climb off the origin", () => {
    // `..` above the root is clamped by the URL parser rather than escaping,
    // so these stay on-origin — asserted so the behaviour is recorded rather
    // than assumed by the next reader.
    assert.equal(safeNextPath("/../../etc/passwd"), "/etc/passwd");
    assert.equal(safeNextPath("/a/../b"), "/b");
  });
});
