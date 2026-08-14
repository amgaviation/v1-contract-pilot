import "server-only";

/**
 * THE flag. docs/PLAN.md Decision #15: build behind a feature flag, ship
 * dark, enable only after Tony reviews docs/CURRENCY-SPEC.md and aviation
 * counsel reviews CURRENCY_DISCLAIMER. This module is where that gate is
 * defined; see lib/currency/read.ts for where it is enforced against I/O
 * and docs/CURRENCY-SPEC.md for the four independent enforcement points a
 * later batch wires once a screen exists (route segment, data boundary,
 * navigation, and the browser-bundle exclusion below).
 */
export const CURRENCY_FLAG_ENV = "CURRENCY_ENGINE_ENABLED";

/**
 * WHY A MISSING VAR READS AS OFF, AND WHY IT IS THIS EXPRESSION AND NOT
 * ANOTHER.
 *
 * `process.env.X` is `undefined` when unset, so `undefined?.trim()`
 * short-circuits to `undefined`, and `undefined !== "true"` is false.
 * Off. That is the default state of every machine that has never been
 * told otherwise: every developer laptop, every CI runner, every preview
 * deployment, and production until someone deliberately types the word.
 *
 * The four wrong ways, each of which has shipped somewhere:
 *   Boolean(process.env.X)        — the string "false" is truthy. Setting
 *                                   the var to "false" to turn the
 *                                   feature OFF turns it ON.
 *   process.env.X !== "false"     — inverts the default. A missing var
 *                                   reads ON, which is the exact failure
 *                                   this gate exists to prevent.
 *   process.env.X !== undefined   — Vercel produces an empty string for a
 *                                   var that is defined but blank, and
 *                                   "" !== undefined. Reads ON.
 *   ["true","1","yes","on"].includes(...) — every accepted spelling is
 *                                   another way a typo or a copied config
 *                                   line turns a counsel-gated feature on.
 *
 * So: one literal, exact match, case-sensitive, after trim. `.trim()` is
 * there because a trailing newline in a .env file or a dashboard paste is
 * invisible and would otherwise read as OFF when the operator believes
 * they turned it on — a failure in the safe direction, but a confusing
 * one. Case-sensitivity is deliberate: "TRUE" reads as OFF, so enabling
 * this feature requires typing exactly the documented value and cannot
 * happen by approximation.
 *
 * The flag name carries NO `NEXT_PUBLIC_` prefix. next.config.ts's `env`
 * block is the only other way a var reaches the browser bundle, and it
 * enumerates exactly two vars with a comment warning against adding to
 * it — CURRENCY_ENGINE_ENABLED is neither prefixed nor listed, so its
 * value is not present in any client chunk, and combined with this file's
 * `import "server-only"`, a client component that tries to import this
 * gate is a BUILD failure, not a runtime surprise.
 */
export function isCurrencyEngineEnabled(): boolean {
  return process.env[CURRENCY_FLAG_ENV]?.trim() === "true";
}

/**
 * Every exported function in lib/currency/read.ts — the only module in
 * lib/currency/** that touches Supabase — calls this first and throws.
 * A route someone adds outside app/(app)/currency/ fails loudly the
 * moment it tries to read a pilot's entries, instead of rendering a panel
 * that looks like a real answer computed from nothing. See
 * docs/CURRENCY-SPEC.md's flag-design section for why this is one of
 * four independent enforcement points, none depending on another.
 */
export function assertCurrencyEngineEnabled(): void {
  if (!isCurrencyEngineEnabled()) {
    throw new Error(
      "Currency engine reached with the flag off. This is a routing or import bug, " +
        "not a config problem. See lib/currency/gate.ts."
    );
  }
}
