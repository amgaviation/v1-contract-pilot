import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * A "use server" module may export FUNCTIONS AND NOTHING ELSE.
 *
 * Every export of such a module becomes a callable server reference that the
 * client invokes by id, so a value that is not a function has no meaning in
 * that contract. Next injects a validator into the compiled module
 * (`ensureServerEntryExports`, node_modules/next/dist/build/webpack/loaders/
 * next-flight-loader/action-validate.js) which walks the export list and
 * throws on the first `typeof !== "function"`:
 *
 *   Error: A "use server" file can only export async functions, found object.
 *
 * THE REASON THIS NEEDS A TEST rather than a code review is WHEN it fails.
 * That validator runs at MODULE EVALUATION on the server. `next build`
 * succeeds, `tsc --noEmit` succeeds — Next's only static counterpart is a
 * TypeScript language-service plugin (next/dist/server/typescript/rules/
 * server-boundary.js), which is editor intellisense and does not run in
 * `tsc` — and the page hosting the actions server-renders normally. The
 * throw arrives in production, in the pilot's browser, the first time they
 * press the button, as the route's error boundary.
 *
 * It has cost this product once already. `app/(app)/settings/account-actions.ts`
 * carried `export { OK as INITIAL_ACCOUNT_ACTION_STATE }` at line 296 of 451,
 * mid-file between the delete action and the hold section rather than at the
 * end — an object, exported from a "use server" file, imported by nothing.
 * Where it sat is part of why review walked past it. Live from
 * 2026-08-18 until it was removed, every action in that file was dead:
 * "Delete account permanently" showed "Deleting…" and then "Something went
 * wrong", having deleted nothing, and reset, deactivate, hold and resume
 * failed identically. One bad export takes the module, not one action.
 *
 * WHAT THIS ACCEPTS, and why it is not stricter. The runtime rule is
 * `typeof === "function"`, so every shape that produces a function is legal:
 * `export const f = async () => {}`, `export default async function f() {}`,
 * `export const f = impl`, `export const f = withAuth(async () => {})`.
 * Next's own TS rule (`server-boundary.js`,
 * `getSemanticDiagnosticsForExportVariableStatement`) whitelists arrow,
 * function, call-expression and identifier initializers, and this accepts
 * the same set. An earlier draft demanded the `export async function`
 * declaration form and would have failed correct code while telling its
 * author, wrongly, that Next refuses the module. A guard that lies about the
 * rule it enforces gets deleted by the next person it blocks.
 *
 * WHERE THIS IS DELIBERATELY STRICTER THAN THE RUNTIME, because "the
 * validator would let it through" is not the same as "it works". Three
 * shapes pass `typeof === "function"` and are still flagged:
 *
 *   - `export function f() {}` — a non-async export. The module evaluates;
 *     the action then fails to return a promise. Next's TS rule rejects it
 *     too, on the return type.
 *   - `export class C {}` — a constructor is not an action.
 *   - `export async function* g() {}` — an async generator returns an async
 *     iterator, not a promise.
 *
 * None of those three throws the error at the top of this file. The
 * assertion message says which claim applies to which, because telling an
 * author their module is refused when it is not is how the last draft of
 * this test earned a rewrite.
 *
 * THE KNOWN GAP. A name this file did not declare is allowed through:
 * `import { CONFIG } from "./config"; export { CONFIG };` is the original
 * incident one module removed, and is not detected. Flagging it would mean
 * failing `import { g } from "./g"; export { g };` — legal, common, and the
 * ordinary way to compose action modules — with no true explanation to give.
 * A certain false accusation is a worse trade than a hypothetical catch for
 * a guard whose whole value is that it does not lie. See locallyNotAFunction.
 *
 * WHAT COUNTS AS MODULE-LEVEL. Only a file whose first statement is the
 * directive. An inline `"use server"` inside a function body marks that one
 * closure and puts no constraint on the file's other exports, so a file
 * carrying one is skipped.
 */

const SOURCE_DIRS = ["app", "lib", "components", "scripts"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

function sourceFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      sourceFiles(join(dir, entry.name), out);
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Blank out comments and string bodies in ONE left-to-right pass, preserving
 * newlines so line structure survives.
 *
 * Deliberately not a chain of regex replaces. The first draft was, and the
 * order made it wrong: template literals were blanked before double-quoted
 * strings, so a lone backtick inside an ordinary string ("a ` b") opened a
 * fake template that swallowed everything up to the next backtick — real
 * exports included. A single pass cannot be fooled that way, because
 * whichever delimiter opens first consumes the rest.
 *
 * Regex literals are not tracked; distinguishing `/` division from a regex
 * needs the parse this file is deliberately not doing. A quote or a backtick
 * inside a regex literal can therefore desynchronise the scan. That usually
 * costs a missed offender, but not always: a backtick in a regex can close
 * against a later template's opening backtick and expose that template's
 * body as live code, which can fabricate an offender out of text. Contrived,
 * and no file in the repo does it, but it is the honest limit of a scanner
 * that is not a parser — so if this test ever accuses a file of an export
 * you cannot find, look for a regex literal above the line it names.
 */
function blankCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const keepNewlines = (text) => text.replace(/[^\n]/g, " ");

  while (i < source.length) {
    const two = source.slice(i, i + 2);

    if (two === "//") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      out += keepNewlines(source.slice(i, stop));
      i = stop;
      continue;
    }

    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += keepNewlines(source.slice(i, stop));
      i = stop;
      continue;
    }

    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === ch) break;
        // An unescaped newline ends a normal string literal; only a template
        // may span lines. Without this, one stray quote eats the whole file.
        if (ch !== "`" && source[j] === "\n") break;
        j += 1;
      }
      const stop = Math.min(j + 1, source.length);
      out += ch + keepNewlines(source.slice(i + 1, stop));
      i = stop;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/**
 * The directive has to be the first statement, but a file may open with a
 * comment or blank lines, so skip those rather than testing line 1
 * literally. Anything else before it means the directive is not
 * module-level and the rule does not apply.
 */
function hasModuleLevelUseServer(source) {
  let rest = source;
  for (;;) {
    const trimmed = rest.replace(/^\s+/, "");
    if (trimmed.startsWith("//")) {
      const nl = trimmed.indexOf("\n");
      if (nl === -1) return false;
      rest = trimmed.slice(nl + 1);
      continue;
    }
    if (trimmed.startsWith("/*")) {
      const end = trimmed.indexOf("*/");
      if (end === -1) return false;
      rest = trimmed.slice(end + 2);
      continue;
    }
    return /^["']use server["']\s*;?/.test(trimmed);
  }
}

/** Is this name declared in this file as something that is not a function? */
function locallyNotAFunction(code, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\basync\\s+function\\s+\\*?\\s*${escaped}\\b`).test(code)) {
    // An async generator is a function by typeof, so the runtime validator
    // lets it through; it is still not a usable action, so say so.
    return new RegExp(`\\basync\\s+function\\s*\\*\\s*${escaped}\\b`).test(code)
      ? "async generator"
      : false;
  }
  if (new RegExp(`\\bfunction\\s+\\*?\\s*${escaped}\\b`).test(code)) return "non-async function";
  if (new RegExp(`\\bclass\\s+${escaped}\\b`).test(code)) return "class";

  const declared = code.match(new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\b`));
  if (declared) {
    const binding = splitBinding(code.slice(declared.index));
    if (binding) return clearlyNotAFunction(binding.init) ? "value" : false;
    return false;
  }

  // Imported, re-exported, or otherwise not declared here. The runtime may
  // well accept it, and this file cannot prove otherwise, so allow it — see
  // THE KNOWN GAP at the top. The incident this guards against was a
  // locally-declared object.
  return false;
}

/**
 * Is this initializer certainly not a function?
 *
 * Asked in the negative on purpose. Asking "is it a function" means
 * enumerating every way to produce one — arrow, function expression,
 * identifier, call, `satisfies`, `as`, parenthesised, decorated — and
 * whatever the list misses becomes a false accusation. The set of things
 * that are certainly NOT functions is small and syntactically obvious:
 * object and array literals, strings, numbers, booleans, null, and `new`.
 * Everything else is given the benefit of the doubt.
 *
 * `new` carries the one exception worth naming, because this file holds
 * itself to literal truth about the runtime: `new Proxy(fn, {})` and
 * `new Function(...)` ARE `typeof "function"`, so they are excluded below
 * rather than flagged. Every other constructor produces a value.
 *
 * `const OK = { error: null, notice: null }` — the original incident — opens
 * with `{`, so it is caught by the first case.
 *
 * String bodies are blanked before this runs but their opening quote
 * survives, which is what the quote characters below match.
 */
function clearlyNotAFunction(text) {
  const head = text.trim();
  return (
    /^[{[]/.test(head) ||
    /^["'`]/.test(head) ||
    /^-?\d/.test(head) ||
    /^new\s+(?!Proxy\b|Function\b)/.test(head) ||
    /^(?:true|false|null|undefined)\b\s*;?$/.test(head)
  );
}

/**
 * Split `NAME: SomeType = initializer` at the assignment.
 *
 * Not a regex, because the obvious one is wrong twice over. `[^=\n]*=` stops
 * at the first `=` on the line, so `Record<string, () => Promise<void>>`
 * ends the match at the arrow's `=` and the real initializer is never seen —
 * an object export wearing a function-shaped annotation slips straight past,
 * which is the incident class this whole file exists for. And forbidding
 * newlines drops a generic annotation broken across lines, which then falls
 * to the catch-all and is reported without a verdict.
 *
 * So: walk to the first `=` at bracket depth zero, skipping the `=` of an
 * arrow.
 *
 * ANGLE BRACKETS ARE NOT COUNTED, and that is the whole trick. Counting them
 * seems obviously right and is wrong twice, because `>` is not reliably a
 * closer — the `>` of `=>` is not closing anything:
 *
 *   Record<string,string>= {a:1}   the `>` decremented, so a guard was added
 *                                  to skip an `=` preceded by `>`; that guard
 *                                  then skipped this real assignment and the
 *                                  object shipped unflagged.
 *   { run: () => void; n: string } the arrow's `>` decremented to zero, so
 *                                  the `;` inside the annotation read as the
 *                                  end of the statement and the scan aborted.
 *
 * Ignoring `<` and `>` entirely makes both correct: `()` and `{}` still
 * balance, so the `;` and the `=` are judged by real nesting.
 *
 * THE COST, and why it is accepted rather than engineered around. A generic
 * default is the one place a bare `=` can sit inside angles, so with angles
 * uncounted the split lands on it and the initializer is never judged:
 *
 *   export const F: <T = string>(x: T) => void = …
 *   export const N: new <T = string>() => object = …
 *
 * A type REFERENCE cannot carry a default (`const x: Foo<T = string>` is
 * TS1005, `'>' expected`), so only these bare function-type and
 * constructor-type annotations reach it.
 *
 * A draft of this file counted that one span to close the gap. It is not in
 * the tree because the gap is not worth the machinery, and the attempt cost
 * a real defect: an unbalanced annotation left the counter stuck, which
 * disabled the `;` terminator, walked the scan into the NEXT declaration and
 * reported that statement's initializer under this one's name — a scanner
 * accusing the wrong export, which is the one failure this file spends its
 * length promising not to produce.
 *
 * What the machinery would have bought is also less than it looks. The shape
 * it catches is `= { a: 1 }` under one of those annotations, and that is
 * already `TS2353` — `tsc` rejects it, and `npm test` runs typecheck before
 * this suite, so the compiler is the guard there. The shape that would slip
 * past both is an `any`-typed initializer (`= JSON.parse(process.env.X)`),
 * which typechecks clean — and no version of this scanner catches it, because
 * clearlyNotAFunction gives every call expression the benefit of the doubt
 * and cannot know a return type. That is the same deliberate policy that
 * lets `withAuth(async () => {})` through, and it is THE KNOWN GAP's
 * territory rather than anything angle-counting could reach.
 *
 * So: this span is passed over, typecheck covers the half that is a type
 * error, and the half neither covers is named at the top of this file.
 *
 * Returns { name, init }, or null when no assignment is found at depth zero.
 * That covers a declaration with no initializer (`let x: Foo;`), which is
 * not an export shape this file needs to judge — and, honestly, any shape
 * whose nesting this scanner reads wrongly. It is a scanner, not a parser;
 * an unsplittable declaration is passed over rather than guessed at.
 */
function splitBinding(head) {
  const named = head.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/);
  if (!named) return null;

  let depth = 0;
  for (let i = named[0].length; i < head.length; i += 1) {
    const ch = head[i];
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) depth -= 1;
    else if (ch === ";" && depth <= 0) return null;
    else if (ch === "=" && depth <= 0 && head[i + 1] !== ">") {
      return { name: named[1], init: head.slice(i + 1) };
    }
  }
  return null;
}

/**
 * The three declaration shapes that pass the runtime's `typeof` check and
 * are still not usable actions. Returns the offence, or null.
 *
 * Shared by the plain and the `default` branches so one defect cannot get
 * two verdicts depending on which keyword it was written behind.
 */
function declarationOffence(head) {
  if (/^async\s+function\s*\*/.test(head)) {
    return `${head.split("\n")[0].trim().slice(0, 40)} (async generator, returns an iterator not a promise)`;
  }
  if (/^function\b/.test(head)) {
    return `${head.split("\n")[0].trim().slice(0, 40)} (not async, so it returns no promise)`;
  }
  if (/^class\b/.test(head)) {
    return `${head.split("\n")[0].trim().slice(0, 40)} (class, not an action)`;
  }
  return null;
}

function offendingExports(source) {
  const code = blankCommentsAndStrings(source);
  const offenders = [];

  for (const match of code.matchAll(/(?:^|\n)[ \t]*export\b/g)) {
    const start = match.index + match[0].length;
    const rest = code.slice(start);
    const head = rest.replace(/^\s+/, "");

    // Erased before the runtime export list exists.
    if (/^(?:type|interface)\b/.test(head)) continue;
    // `export * from "…"` and `export * as ns from "…"` re-export whatever
    // the target has; unverifiable here, and legal when the target is clean.
    if (/^\*/.test(head)) continue;

    // `export { a, b as c }`, possibly spanning lines.
    const list = head.match(/^\{([\s\S]*?)\}/);
    if (list) {
      const bad = list[1]
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        // `export { type T, f }` — the type specifier is erased.
        .filter((part) => !/^type\s/.test(part) && part !== "type")
        .map((part) => part.split(/\s+as\s+/)[0].trim())
        .map((name) => [name, locallyNotAFunction(code, name)])
        .filter(([, why]) => why !== false)
        .map(([name, why]) => `${name} (${why})`);
      if (bad.length > 0) offenders.push(`export { ${bad.join(", ")} }`);
      continue;
    }

    if (/^default\b/.test(head)) {
      const after = head.replace(/^default\b/, "").trim();
      // The same three declaration shapes get the same answer here as they
      // do without `default`. An earlier draft accepted
      // `export default function f() {}` while flagging `export function
      // f() {}`, which is one defect wearing two verdicts.
      const declared = declarationOffence(after);
      if (declared) {
        offenders.push(`export default ${declared}`);
        continue;
      }
      if (/^(?:async\s+function|function)\b/.test(after)) continue;

      const name = after.match(/^([A-Za-z_$][\w$]*)\s*;?$/);
      if (name) {
        const why = locallyNotAFunction(code, name[1]);
        if (why !== false) offenders.push(`export default ${name[1]} (${why})`);
        continue;
      }
      if (clearlyNotAFunction(after)) {
        offenders.push(`export default ${after.split("\n")[0].slice(0, 40)} (value)`);
      }
      continue;
    }

    const declared = declarationOffence(head);
    if (declared) {
      offenders.push(`export ${declared}`);
      continue;
    }
    if (/^(?:async\s+function|function)\b/.test(head)) continue;

    const binding = splitBinding(head);
    if (binding) {
      if (clearlyNotAFunction(binding.init)) {
        offenders.push(`export const ${binding.name} (value)`);
      }
      continue;
    }
    if (/^(?:const|let|var)\b/.test(head)) continue;

    // Every shape this file knows about has been handled above, so reaching
    // here means an export form the scanner does not recognise. Say that,
    // rather than leaving a bare line the assertion's legend cannot explain.
    offenders.push(
      `export ${head.split("\n")[0].trim().slice(0, 60)} (unrecognised shape, check it by hand)`
    );
  }

  return offenders;
}

const actionModules = SOURCE_DIRS.flatMap((dir) => sourceFiles(dir))
  .map((path) => ({ path, source: readFileSync(join(ROOT, path), "utf8") }))
  .filter(({ source }) => hasModuleLevelUseServer(source));

test('every module-level "use server" file is found', () => {
  assert.ok(
    actionModules.length > 10,
    `found only ${actionModules.length} "use server" modules — the walk is probably broken, not the repo`
  );
});

test('a "use server" file exports functions and nothing else', () => {
  const failures = actionModules
    .map(({ path, source }) => ({ path, offenders: offendingExports(source) }))
    .filter(({ offenders }) => offenders.length > 0);

  assert.deepEqual(
    failures.map(({ path, offenders }) => `${relative(".", path)}: ${offenders.join("; ")}`),
    [],
    'a "use server" module may only export functions.\n' +
      "  (value) — Next REFUSES THE WHOLE MODULE at runtime, and every action in the file then " +
      "throws the first time a pilot presses the button. The build and typecheck both pass, so " +
      "this is the one that reaches production. Move the value to a plain module and import it " +
      "from both sides.\n" +
      "  (not async) / (async generator) / (class) — the module still evaluates; Next's typeof " +
      "check accepts all three. They are flagged because an action has to return a promise and " +
      "none of these does, so the failure lands on the caller instead. Make it an async function."
  );
});

/**
 * The guard's own guard. Each case is a shape the scanner has to classify
 * correctly, and several are here because an earlier draft got them wrong:
 * the arrow-function export it would have falsely rejected, the multi-line
 * export list Prettier produces, the `type` specifier inside a list, and the
 * backtick-inside-a-string that desynchronised the old regex-chain stripper.
 */
test("the scanner classifies the shapes it will actually meet", () => {
  const legal = {
    "async function declaration": `"use server";\nexport async function f() {}\n`,
    "default async function": `"use server";\nexport default async function f() {}\n`,
    "async arrow const": `"use server";\nexport const f = async () => {};\n`,
    "typed async arrow const": `"use server";\nexport const f: Act = async (s: S) => s;\n`,
    "async function expression": `"use server";\nexport const f = async function () {};\n`,
    "list of local async functions": `"use server";\nasync function a() {}\nexport { a as b };\n`,
    "multi-line list": `"use server";\nasync function a() {}\nasync function b() {}\nexport {\n  a,\n  b,\n};\n`,
    "type specifier in list": `"use server";\nasync function f() {}\nexport { type T, f };\n`,
    "re-export from another module": `"use server";\nimport { g } from "./g";\nexport { g };\n`,
    "star re-export": `"use server";\nexport * from "./other";\n`,
    "identifier initializer": `"use server";\nasync function impl() {}\nexport const f = impl;\n`,
    "call-expression initializer": `"use server";\nexport const f = withAuth(async () => {});\n`,
    "default call-expression": `"use server";\nexport default withAuth(async () => {});\n`,
    "satisfies wrapper": `"use server";\nexport const f = (async () => {}) satisfies Act;\n`,
    "as-cast wrapper": `"use server";\nexport const f = (async () => {}) as Act;\n`,
    "arrow inside a generic annotation": `"use server";\nexport const g: Handler<() => Promise<void>> = async () => {};\n`,
    "annotation broken across lines": `"use server";\nexport const f: Action<\n  State,\n  FormData\n> = async () => {};\n`,
    "new Proxy is typeof function": `"use server";\nexport const f = new Proxy(async () => {}, {});\n`,
    // The brace puts the type parameter's default at depth one, so this
    // splits on the real `=` without any angle handling. Pinned because a
    // draft that DID count angles got this case right by accident and the
    // adjacent bare-annotation cases wrong; see splitBinding's cost note.
    "call signature inside an object type": `"use server";\nexport const f: { <T = string>(x: T): void } = (x) => {};\n`,
    "type and interface": `"use server";\nexport type T = { a: 1 };\nexport interface I { a: 1 }\nexport async function f() {}\n`,
    "directive after comments": `// note\n/* block */\n\n"use server";\nexport async function f() {}\n`,
    "single-quoted directive": `'use server';\nexport async function f() {}\n`,
    "export word inside a string": `"use server";\nconst s = "export const X = {}";\nexport async function f() {}\n`,
  };

  // Each case pins the offender string, not just that SOMETHING was flagged.
  // Asserting only `length > 0` lets the message drift into nonsense while
  // the suite stays green, and the message is the whole point: it is what
  // the blocked author reads.
  const illegal = {
    "the real incident": [`"use server";\nconst OK = {};\nexport { OK as INIT };\n`, "export { OK (value) }"],
    "exported object const": [`"use server";\nexport const OK = { a: 1 };\n`, "export const OK (value)"],
    "exported number": [`"use server";\nexport const N = 42;\n`, "export const N (value)"],
    "export let": [`"use server";\nexport let counter = 0;\n`, "export const counter (value)"],
    "exported string": [`"use server";\nexport const S = "x";\n`, "export const S (value)"],
    "default a local object": [`"use server";\nconst OK = {};\nexport default OK;\n`, "export default OK (value)"],
    "default an object literal": [`"use server";\nexport default { a: 1 };\n`, "(value)"],
    "non-async function": [`"use server";\nexport function f() {}\n`, "(not async"],
    "default non-async function": [`"use server";\nexport default function f() {}\n`, "(not async"],
    "exported class": [`"use server";\nexport class C {}\n`, "(class"],
    "default class": [`"use server";\nexport default class C {}\n`, "(class"],
    "async generator": [`"use server";\nexport async function* g() {}\n`, "(async generator"],
    "list naming a local class": [`"use server";\nclass C {}\nexport { C };\n`, "export { C (class) }"],
    // The incident class wearing a function-shaped type annotation. The
    // obvious `[^=\n]*=` binding regex stops at the arrow's `=` and never
    // sees the `{}`, so this shipped as a false negative until splitBinding
    // replaced it.
    "object hidden behind an arrow in its annotation": [
      `"use server";\nexport const HANDLERS: Record<string, () => Promise<void>> = { a: 1 };\n`,
      "export const HANDLERS (value)",
    ],
    "same, via a list export": [
      `"use server";\nconst OK: Record<string, () => void> = { a: 1 };\nexport { OK };\n`,
      "export { OK (value) }",
    ],
    // No space before the `=`. An earlier splitBinding counted `<`/`>` as
    // brackets, so the annotation's closing `>` sat immediately before the
    // assignment and a `>=` guard skipped it — the object then shipped
    // unflagged. Angle brackets are no longer counted; see splitBinding.
    "annotation flush against the assignment": [
      `"use server";\nexport const X: Record<string,string>= { a: 1 };\n`,
      "export const X (value)",
    ],
    // The arrow's `>` used to close the annotation's `{`, so this `;` read
    // as the end of the statement and the scan gave up before the `= {}`.
    "arrow inside an inline object-type annotation": [
      `"use server";\nexport const H: { run: () => void; n: string } = { a: 1 };\n`,
      "export const H (value)",
    ],
    "backtick inside a string hides nothing": [
      `"use server";\nconst s = "a \` b";\nexport const BAD = { a: 1 };\n`,
      "export const BAD (value)",
    ],
  };

  for (const [name, src] of Object.entries(legal)) {
    assert.ok(hasModuleLevelUseServer(src), `${name}: should be seen as module-level`);
    assert.deepEqual(offendingExports(src), [], `${name}: legal, must not be flagged`);
  }

  for (const [name, [src, expected]] of Object.entries(illegal)) {
    assert.ok(hasModuleLevelUseServer(src), `${name}: should be seen as module-level`);
    const found = offendingExports(src);
    assert.ok(found.length > 0, `${name}: illegal, must be flagged`);
    assert.ok(
      found.some((offender) => offender.includes(expected)),
      `${name}: expected an offender containing ${JSON.stringify(expected)}, got ${JSON.stringify(found)}`
    );
  }

  // An inline directive constrains one closure, not the file's exports.
  const inline = `export const x = 1;\nasync function f() { "use server"; }\n`;
  assert.equal(hasModuleLevelUseServer(inline), false, "inline directive is out of scope");

  // A directive that is not the first statement is not module-level either.
  const late = `import x from "y";\n"use server";\nexport const BAD = {};\n`;
  assert.equal(hasModuleLevelUseServer(late), false, "directive after an import is not module-level");

  // THE ACCEPTED COST, pinned so it cannot change without someone noticing.
  // A generic default puts a bare `=` inside angles, which splitBinding does
  // not count, so these split early and are passed over. Both annotations
  // compile; the object literal under them does not — `= { a: 1 }` is TS2353
  // — and `npm test` runs typecheck before this suite, so the compiler holds
  // that half. The half nothing holds is an `any`-typed initializer, which
  // typechecks clean and is passed over by clearlyNotAFunction's deliberate
  // benefit of the doubt for call expressions, exactly as `withAuth(...)` is.
  // splitBinding's comment records why counting the span was tried and
  // reverted.
  for (const src of [
    `"use server";\nexport const F: <T = string>(x: T) => void = { a: 1 };\n`,
    `"use server";\nexport const N: new <T = string>() => object = { a: 1 };\n`,
    `"use server";\nexport const Z: <T = string>(x: T) => void = JSON.parse("{}");\n`,
  ]) {
    assert.deepEqual(
      offendingExports(src),
      [],
      "the generic-default span is deliberately passed over; if this now fails, splitBinding changed and its cost note must be rewritten"
    );
  }

  // And the legal shapes wearing the same annotations must stay clean, which
  // is the half of that trade that would actually hurt if it broke.
  for (const src of [
    `"use server";\nexport const F: <T = string>(x: T) => void = async () => {};\n`,
    `"use server";\nexport const N: new <T = string>() => object = klass;\n`,
  ]) {
    assert.deepEqual(offendingExports(src), [], "a generic default must not make a real function look like a value");
  }
});
