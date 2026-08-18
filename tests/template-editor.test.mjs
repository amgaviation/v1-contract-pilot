import test from "node:test";
import assert from "node:assert/strict";

const { insertToken } = await import("../lib/message-templates.ts");

/**
 * The chip row's one string operation, pinned on its own.
 *
 * insertToken lives in lib/message-templates.ts rather than in
 * app/(app)/settings/template-editor.tsx, where it is actually called from
 * — see that file's header for why. In short: this suite runs under Node's
 * `--experimental-strip-types` (package.json's test:unit), which erases
 * TypeScript's type syntax but has no JSX transform, so a `.tsx` file
 * fails with `ERR_UNKNOWN_FILE_EXTENSION` before this runner even gets to
 * parse it — confirmed directly against this repo's test runner while
 * building this feature, not assumed from memory.
 */

test("insertToken", async (t) => {
  await t.test("at the start of the text", () => {
    const rest = "owes the balance.";
    const token = "{{client_name}}";
    const r = insertToken(rest, 0, 0, token);
    assert.equal(r.text, token + rest);
    assert.equal(r.caret, token.length);
  });

  await t.test("in the middle of the text", () => {
    const prefix = "Invoice ";
    const suffix = " is attached.";
    const token = "{{invoice_number}}";
    const r = insertToken(prefix + suffix, prefix.length, prefix.length, token);
    assert.equal(r.text, prefix + token + suffix);
    assert.equal(r.caret, prefix.length + token.length);
  });

  await t.test("at the end of the text", () => {
    const base = "Thanks for your business,";
    const token = " {{client_name}}";
    const r = insertToken(base, base.length, base.length, token);
    assert.equal(r.text, base + token);
    assert.equal(r.caret, r.text.length);
  });

  await t.test("replacing an active selection, not appending after it", () => {
    // A pilot re-selects a stray hand-typed name and clicks the "Client
    // name" chip: the selection must be REPLACED, matching what typing a
    // character over a selection does natively — not left in place with
    // the token landing after it.
    const before = "Hello ";
    const selected = "Dana";
    const after = ", invoice attached.";
    const token = "{{client_name}}";
    const r = insertToken(
      before + selected + after,
      before.length,
      before.length + selected.length,
      token
    );
    assert.equal(r.text, before + token + after);
    assert.equal(r.caret, before.length + token.length);
  });

  await t.test("into empty text", () => {
    const token = "{{amount_due}}";
    const r = insertToken("", 0, 0, token);
    assert.equal(r.text, token);
    assert.equal(r.caret, token.length);
  });

  await t.test("clamps an out-of-range selection instead of trusting it", () => {
    // start/end are read from the DOM one event earlier than they're used;
    // nothing at the type level stops a stale index from outliving a
    // shorter text. Must not wrap via .slice's negative-index behaviour
    // and splice the token into the wrong place.
    const r = insertToken("short", 50, 999, "{{x}}");
    assert.equal(r.text, "short{{x}}");
    assert.equal(r.caret, "short{{x}}".length);
  });
});
