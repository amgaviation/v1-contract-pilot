#!/usr/bin/env node
/**
 * Copies the receipt-OCR engine's static assets out of node_modules and
 * into public/ocr/, where the browser can fetch them from this origin.
 *
 * WHY THIS EXISTS AT ALL. tesseract.js, left alone, fetches its WebAssembly
 * core and its language model from jsdelivr at runtime (see
 * node_modules/tesseract.js/src/worker-script/browser/getCore.js and
 * .../worker-script/index.js — the `|| 'https://cdn.jsdelivr.net/...'`
 * fallbacks). That is three separate problems for this product:
 *
 *   1. It is a third-party origin executing WebAssembly inside a page that
 *      shows a pilot's clients, rates and revenue. next.config.ts already
 *      carries a note that a Content-Security-Policy is owed here; a CDN
 *      dependency would have to be punched through it forever.
 *   2. It is a runtime dependency on someone else's uptime for a feature a
 *      pilot uses standing at a fuel desk. Self-hosted, the assets are as
 *      available as the app itself.
 *   3. It removes a second, independent version resolution. tesseract.js
 *      builds its CDN URL from the `^7.0.0` range in its own package.json,
 *      so jsdelivr could serve different bytes on two different days with
 *      no change here. Copying from node_modules means the bytes are
 *      whatever install produced — which package-lock.json plus CI's
 *      `npm ci` pin, and which nothing else can move. Worth stating
 *      precisely: it is the LOCKFILE that pins the version, not this
 *      script. Self-hosting removes the runtime resolution; it does not by
 *      itself guarantee a fixed version.
 *
 * WHY IT IS A COPY AND NOT A COMMIT. These are ~11 MB of binaries whose
 * source of truth is package-lock.json. Committing them would put a
 * multi-megabyte blob in git history for every version bump and let the
 * checked-in copy silently drift from the pinned dependency. public/ocr/
 * is gitignored and rebuilt from node_modules by `prebuild` and `predev`,
 * so the pinned version is the only version that can ever be served.
 *
 * WHICH VARIANTS, AND WHY ONLY THESE. tesseract.js picks its core file at
 * runtime from the browser's WebAssembly SIMD support — relaxed-SIMD,
 * SIMD, or neither — so all three must exist on disk even though any one
 * browser downloads exactly one. Only the `-lstm` builds are copied:
 * createWorker.js line 36 sets `lstmOnly` for OEM.DEFAULT, which is what
 * lib/receipt-ocr/engine.ts uses, and the legacy-model builds it would
 * otherwise reach for are 0.5 MB larger apiece and never requested. If
 * that OEM ever changes, this list has to change with it — hence the
 * assertion below rather than a silent 404 in front of a pilot.
 *
 * ONLY THE .wasm.js, NOT THE .wasm. tesseract.js-core ships each core as a
 * matched pair, which reads like both halves are needed. They are not:
 * the `.wasm.js` is an Emscripten SINGLE_FILE build with the binary
 * inlined as base64, and it never fetches its sibling. Verified rather
 * than assumed — the glue was loaded in Node with fs.readFileSync
 * instrumented, and it instantiated 354 exports without touching a single
 * `.wasm` file. Copying them anyway would put 7.6 MB into every
 * deployment that no browser will ever request.
 */
import { copyFileSync, mkdirSync, existsSync, statSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const OUT = join(ROOT, "public", "ocr");

/** Resolved from the installed package, never from a hardcoded path. */
function packageDir(name) {
  return dirname(require.resolve(`${name}/package.json`));
}

const CORE_VARIANTS = [
  "tesseract-core-relaxedsimd-lstm",
  "tesseract-core-simd-lstm",
  "tesseract-core-lstm",
];

function copy(from, to, label) {
  if (!existsSync(from)) {
    console.error(`sync-ocr-assets: missing ${label}\n  expected: ${from}`);
    process.exit(1);
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  return statSync(to).size;
}

let bytes = 0;

// 1. The worker script. tesseract.js fetches this and turns it into a blob
//    URL (workerBlobURL defaults true), so it must be same-origin.
const tesseractDir = packageDir("tesseract.js");
bytes += copy(
  join(tesseractDir, "dist", "worker.min.js"),
  join(OUT, "worker.min.js"),
  "tesseract.js worker script"
);

// 2. The WebAssembly cores, one per SIMD tier. See the header: the .wasm.js
//    carries its own binary, so the sibling .wasm is deliberately not copied.
const coreDir = packageDir("tesseract.js-core");
for (const variant of CORE_VARIANTS) {
  bytes += copy(
    join(coreDir, `${variant}.wasm.js`),
    join(OUT, "core", `${variant}.wasm.js`),
    `${variant} core`
  );
}

// 3. The English language model. `4.0.0_best_int` is the integerised model
//    tesseract.js itself defaults to under lstmOnly — 2.9 MB against the
//    combined model's 10.9 MB, for the same LSTM recognition path.
const engDir = packageDir("@tesseract.js-data/eng");
bytes += copy(
  join(engDir, "4.0.0_best_int", "eng.traineddata.gz"),
  join(OUT, "lang", "eng.traineddata.gz"),
  "eng language model"
);

// A regression to a CDN default would surface as remote code executing in
// the pilot's session, or as a 404 inside a web worker — neither of which
// is diagnosable from the outside. Assert the coupling here instead.
//
// ALL THREE PATHS, not just one. This check used to test `corePath` alone,
// and a security review demonstrated the hole by deleting the workerPath
// and langPath lines from engine.ts and running this script against that
// tree: it printed its success line and exited 0. Each path has its own
// independent jsdelivr fallback —
//   workerPath  src/worker/browser/defaultOptions.js
//   corePath    src/worker-script/browser/getCore.js
//   langPath    src/worker-script/index.js
// — and `workerPath` is the one that matters most: spawnWorker.js feeds it
// to importScripts() inside a worker that inherits this document's origin,
// so losing it means CDN-served JavaScript running with the pilot's
// session, not in a sandbox.
const engineSource = readFileSync(join(ROOT, "lib", "receipt-ocr", "engine.ts"), "utf8");
const REQUIRED_PATHS = [
  ['workerPath: "/ocr/worker.min.js"', "the worker script"],
  ['corePath: "/ocr/core"', "the WebAssembly core"],
  ['langPath: "/ocr/lang"', "the language model"],
];
for (const [needle, what] of REQUIRED_PATHS) {
  if (engineSource.includes(needle)) continue;
  console.error(
    `sync-ocr-assets: lib/receipt-ocr/engine.ts no longer self-hosts ${what}.\n` +
      `  expected to find: ${needle}\n` +
      "Without it tesseract.js falls back to jsdelivr — see the header of this\n" +
      "file for why that is not allowed. If the layout changed deliberately,\n" +
      "update REQUIRED_PATHS here to match."
  );
  process.exit(1);
}
// The blob indirection exists in tesseract.js only to work around loading a
// worker from a cross-origin CDN. Same-origin, it buys nothing and costs
// `blob:` in script-src forever — a standard CSP-bypass primitive, and
// next.config.ts already owes this app a CSP.
if (!/workerBlobURL:\s*false/.test(engineSource)) {
  console.error(
    "sync-ocr-assets: engine.ts must pass workerBlobURL: false. The default\n" +
      "wraps the worker in a blob: URL, which would force `script-src blob:`\n" +
      "into the Content-Security-Policy this app still owes."
  );
  process.exit(1);
}
if (/legacyCore|TESSERACT_ONLY|TESSERACT_LSTM_COMBINED/.test(engineSource)) {
  console.error(
    "sync-ocr-assets: engine.ts requests a legacy Tesseract model, but only\n" +
      "the -lstm cores are copied. Add the non-lstm variants to CORE_VARIANTS."
  );
  process.exit(1);
}

console.log(
  `sync-ocr-assets: ${(bytes / 1024 / 1024).toFixed(1)} MB into public/ocr ` +
    `(${CORE_VARIANTS.length} core variants + worker + eng model)`
);
