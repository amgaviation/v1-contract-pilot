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
 *   3. The version is resolved from a semver range in tesseract.js's own
 *      package.json, so the bytes executed could change without a commit
 *      here.
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

// A wrong-variant guess would surface as a 404 inside a web worker in
// front of a pilot, which is close to undiagnosable. Assert the coupling
// here instead: engine.ts must not ask for a core this script didn't copy.
const engineSource = readFileSync(join(ROOT, "lib", "receipt-ocr", "engine.ts"), "utf8");
if (!engineSource.includes('corePath: "/ocr/core"')) {
  console.error(
    "sync-ocr-assets: lib/receipt-ocr/engine.ts no longer points corePath at\n" +
      "/ocr/core. Either it regressed to the jsdelivr default (see the header\n" +
      "of this file for why that is not allowed) or the layout changed and\n" +
      "this script needs updating."
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
