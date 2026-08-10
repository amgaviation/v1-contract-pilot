#!/usr/bin/env node
/**
 * Drives the REAL receipt-OCR engine in a real browser against a synthetic
 * receipt, and asserts the things that unit tests structurally cannot.
 *
 * WHY THIS EXISTS SEPARATELY FROM tests/. lib/receipt-ocr/extract.ts is
 * pure and is unit-tested. lib/receipt-ocr/engine.ts is not testable that
 * way and never will be: it decodes an image, draws to a 2D canvas, reads
 * the pixels back, and drives a WebAssembly worker. None of that exists in
 * Node. So it gets the same treatment every other untestable-in-isolation
 * guarantee in this repo gets — a probe against the real runtime, in the
 * house `*-verify.mjs` style.
 *
 * The three claims it checks are the three that were ASSERTED IN COMMENTS
 * before they were ever measured, which is exactly the kind of claim that
 * turns out to be wrong:
 *
 *   1. A scan makes ZERO off-origin requests. tesseract.js falls back to
 *      jsdelivr for its core and to tessdata for its language model, and
 *      the self-hosting in engine.ts + scripts/sync-ocr-assets.mjs only
 *      works if every one of those fallbacks is actually closed off. A
 *      grep cannot prove that; watching the network can.
 *   2. The amount comes from the LABELLED total. The fixture prints a
 *      2,826.31 line item, a 3,151.31 subtotal and a 412.6 gallon figure
 *      above a $3,371.90 total, so first-number, largest-number and
 *      last-number strategies each produce a different wrong answer.
 *   3. A degraded photo yields NOTHING rather than something wrong. This
 *      is the property the whole feature rests on, and the only honest way
 *      to check it is to feed the pipeline a genuinely bad image.
 *
 * Not wired into `npm test`, deliberately: it needs Playwright and a
 * Chromium, neither of which is a dependency of this project, and making
 * them one to cover a single module would cost every contributor a browser
 * download. It skips with a clear message when they are absent.
 *
 * Run: npm run receipt-ocr:verify
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname, join, normalize, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const WORK = join(tmpdir(), "v1-receipt-ocr-verify");
const PORT = 8471;

const say = (...args) => console.log(...args);
let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  say(`  ${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`}`);
}

/**
 * Playwright is not a dependency here. It is, however, commonly present
 * globally on a machine that has Chromium — so it is looked for rather
 * than required, and its absence is a skip, not a failure.
 */
async function loadChromium() {
  const require = createRequire(import.meta.url);
  const candidates = [
    "playwright",
    "playwright-core",
    "/opt/node22/lib/node_modules/playwright/index.mjs",
    "/usr/lib/node_modules/playwright/index.mjs",
  ];
  for (const candidate of candidates) {
    try {
      const specifier = candidate.startsWith("/") ? candidate : require.resolve(candidate);
      const mod = await import(specifier.startsWith("/") ? specifier : `file://${specifier}`);
      if (mod.chromium) return mod.chromium;
    } catch {
      // try the next one
    }
  }
  return null;
}

const chromium = await loadChromium();
if (!chromium) {
  say("receipt-ocr:verify SKIPPED — Playwright not found.");
  say("  This probe needs a real browser. Install Playwright and a Chromium,");
  say("  then re-run. Nothing about the app is broken by this skip.");
  process.exit(0);
}

if (!existsSync(join(ROOT, "public", "ocr", "worker.min.js"))) {
  say("receipt-ocr:verify: public/ocr is not populated — running the sync first.");
  execFileSync(process.execPath, [join(ROOT, "scripts", "sync-ocr-assets.mjs")], { stdio: "inherit" });
}

// ---------------------------------------------------------------------------
// Transpile the real modules. Not a re-implementation and not a copy: the
// files under lib/receipt-ocr are compiled as-is, so a change to the
// shipping code is a change to what this probe measures.
// ---------------------------------------------------------------------------
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
try {
  execFileSync(
    join(ROOT, "node_modules", ".bin", "tsc"),
    [
      "lib/receipt-ocr/engine.ts",
      "lib/receipt-ocr/extract.ts",
      "lib/format.ts",
      "--outDir", join(WORK, "mod"),
      "--module", "esnext",
      "--target", "es2022",
      "--moduleResolution", "bundler",
      "--skipLibCheck",
    ],
    { cwd: ROOT, stdio: "pipe" }
  );
} catch (error) {
  // tsc exits non-zero on the unresolved "@/lib/format" path alias, which
  // is rewritten below. Any OTHER diagnostic is a real problem.
  const out = String(error.stdout ?? "") + String(error.stderr ?? "");
  const unexpected = out
    .split("\n")
    .filter((line) => line.includes("error TS") && !line.includes("Cannot find module '@/lib/format'"));
  if (unexpected.length > 0) {
    say("receipt-ocr:verify: the modules did not compile.\n" + unexpected.join("\n"));
    process.exit(1);
  }
}

const extractPath = join(WORK, "mod", "receipt-ocr", "extract.js");
writeFileSync(
  extractPath,
  readFileSync(extractPath, "utf8").replace('"@/lib/format"', '"../format.js"')
);

// The browser needs a real module specifier for the bare "tesseract.js"
// import inside engine.ts. An import map supplies it, pointing at the
// package's own ESM build.
const TESSERACT_ESM = join(ROOT, "node_modules", "tesseract.js", "dist", "tesseract.esm.min.js");

writeFileSync(
  join(WORK, "index.html"),
  `<!doctype html><meta charset="utf-8">
<script type="importmap">{"imports":{"tesseract.js":"/vendor/tesseract.esm.min.js"}}</script>
<canvas id="stage" width="900" height="1180"></canvas>
<script type="module">
import { readReceipt } from "/mod/receipt-ocr/engine.js";
import { extractReceipt } from "/mod/receipt-ocr/extract.js";

// A synthetic FBO fuel invoice, drawn here rather than photographed. No
// real receipt and no live pilot data — the rule the unit tests follow.
// The numbers are chosen so that "first number", "largest number" and
// "last number" each give a DIFFERENT wrong answer than the labelled
// total, which is the rule actually under test.
const LINES = [
  ["SYNTHETIC AVIATION SERVICES", 40, "bold"],
  ["KTEB - Teterboro, NJ", 28, ""],
  ["", 20, ""],
  ["Invoice 884213                03/15/2026", 30, ""],
  ["", 16, ""],
  ["Aircraft: N447SP              Trip: 1188", 30, ""],
  ["", 24, ""],
  ["Jet A   412.6 GAL @ 6.85         2,826.31", 30, ""],
  ["Ramp Fee                           250.00", 30, ""],
  ["GPU                                 75.00", 30, ""],
  ["", 16, ""],
  ["Subtotal                         3,151.31", 30, ""],
  ["Sales Tax                          220.59", 30, ""],
  ["TOTAL DUE                       $3,371.90", 34, "bold"],
];

function draw() {
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Grey on off-white, not black on white: a thermal receipt photographed
  // in an FBO lounge is never a clean scan, and the engine's contrast
  // stretch is part of what is being measured.
  ctx.fillStyle = "#4a4a4a";
  let y = 90;
  for (const [text, size, weight] of LINES) {
    ctx.font = weight + " " + size + "px monospace";
    ctx.fillText(text, 60, y);
    y += size + 22;
  }
  return canvas;
}

// Rotation, washed-out contrast, sensor noise and hard JPEG — a photo
// taken one-handed, not a scan.
function degrade(canvas, angle, noise) {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const c = out.getContext("2d");
  c.fillStyle = "#c8c2b4";
  c.fillRect(0, 0, out.width, out.height);
  c.translate(out.width / 2, out.height / 2);
  c.rotate((angle * Math.PI) / 180);
  c.globalAlpha = 0.5;
  c.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  const frame = c.getImageData(0, 0, out.width, out.height);
  for (let i = 0; i < frame.data.length; i += 4) {
    // Deterministic per-pixel noise, so a failure here is reproducible
    // rather than a coin flip that passes on the re-run.
    const n = (((i * 2654435761) % 1000) / 1000 - 0.5) * noise;
    frame.data[i] += n;
    frame.data[i + 1] += n;
    frame.data[i + 2] += n;
  }
  c.putImageData(frame, 0, 0);
  return out;
}

async function scan(canvas, quality) {
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
  const file = new File([blob], "receipt.jpg", { type: "image/jpeg" });
  const { text, confidence } = await readReceipt(file, () => {});
  // Confidence is passed through exactly as the UI does it — the vendor
  // floor only exists if this argument is actually threaded here.
  return { extraction: extractReceipt(text, { confidence }), confidence: Math.round(confidence), text };
}

window.runClean = () => scan(draw(), 0.85);
window.runDegraded = (angle, noise, quality) => scan(degrade(draw(), angle, noise), quality);
window.runPdf = async () => {
  const file = new File([new Uint8Array([37, 80, 68, 70])], "r.pdf", { type: "application/pdf" });
  try {
    await readReceipt(file, () => {});
    return { threw: false };
  } catch (e) {
    return { threw: true, name: e.name, message: e.message };
  }
};
</script>`
);

// ---------------------------------------------------------------------------
// A static server over exactly three roots. Everything the page can reach
// is same-origin by construction, so any request to another host in the
// log below is a real fallback that escaped, not a test artifact.
// ---------------------------------------------------------------------------
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".gz": "application/gzip", ".wasm": "application/wasm", ".json": "application/json",
};
const ROOTS = [
  ["/vendor/tesseract.esm.min.js", () => TESSERACT_ESM],
  ["/ocr/", (p) => join(ROOT, "public", "ocr", p.slice("/ocr/".length))],
  ["/mod/", (p) => join(WORK, "mod", p.slice("/mod/".length))],
  ["/", (p) => join(WORK, p === "/" ? "index.html" : p.slice(1))],
];

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const entry = ROOTS.find(([prefix]) => path === prefix || path.startsWith(prefix));
  const file = entry ? normalize(entry[1](path)) : null;
  // Containment check: this server is short-lived and local, but a path
  // that escapes its root is a bug worth failing on rather than serving.
  const contained =
    file && [join(ROOT, "public", "ocr"), WORK, TESSERACT_ESM].some((base) => file === base || file.startsWith(base + sep));
  if (!file || !contained || !existsSync(file)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const browser = await chromium.launch();
const page = await browser.newPage();
const requested = [];
page.on("request", (r) => requested.push(r.url()));
page.on("pageerror", (e) => {
  failures++;
  say(`  FAIL  uncaught page error: ${e.message.slice(0, 200)}`);
});

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });

  say("\nA clean render of a synthetic FBO fuel invoice");
  const clean = await page.evaluate(() => window.runClean());
  const e = clean.extraction;
  check("the amount is the LABELLED total, not the line item or the subtotal", e.amountCents, 337190);
  check("the invoice date is read", e.date, "2026-03-15");
  check("the tail number is read", e.aircraftIdent, "N447SP");
  check("the airport is read", e.airportIdents, ["KTEB"]);
  check("Jet A is categorised as fuel, not Other", e.category, "fuel");
  check("the uplift is read as gallons, not as money", e.gallons, 412.6);
  check("the vendor is the receipt's own header, with no edge artifact", e.vendor, "SYNTHETIC AVIATION SERVICES");
  say(`  info  confidence ${clean.confidence}`);

  say("\nA photograph bad enough that the total does not survive");
  const bad = await page.evaluate(() => window.runDegraded(11, 130, 0.3));
  // THE property this feature rests on. Not "it still reads it" — it must
  // return NOTHING rather than a number the pilot would confirm. A wrong
  // amount that looks right is the one outcome worse than no amount.
  check("no amount is invented from an unreadable total", bad.extraction.amountCents, null);
  check("no date is invented either", bad.extraction.date, null);
  // The vendor has no shape to fail, so it is the one field that will
  // happily hand back OCR noise. Gated on confidence instead.
  check("no vendor is invented from text that is not words", bad.extraction.vendor, null);
  check("so the UI is told nothing was read, and says so", bad.extraction.filled, []);
  say(`  info  confidence ${bad.confidence}`);

  say("\nA PDF is refused with a sentence, not a stack trace");
  const pdf = await page.evaluate(() => window.runPdf());
  check("it throws", pdf.threw, true);
  check("as a named error the UI can present", pdf.name, "ReceiptOcrError");

  say("\nEverything the scan fetched");
  const offOrigin = requested.filter(
    (u) => !u.startsWith(`http://127.0.0.1:${PORT}`) && !u.startsWith("blob:") && !u.startsWith("data:")
  );
  // The claim in scripts/sync-ocr-assets.mjs and lib/receipt-ocr/engine.ts
  // is that self-hosting closes every CDN fallback in tesseract.js. This
  // is the only thing that can actually prove it.
  check("zero off-origin requests during a scan", offOrigin, []);
  // tesseract.js defaults to re-serving the worker from a blob: URL, which
  // would force `script-src blob:` into the CSP this app owes. Turned off
  // in engine.ts; asserted here because "the option is set" and "the
  // browser therefore loads the worker directly" are different claims.
  check(
    "the worker is loaded from its real URL, not a blob:",
    requested.filter((u) => u.startsWith("blob:")),
    []
  );
  for (const url of requested.filter((u) => u.includes("/ocr/"))) {
    say(`  info  ${url.replace(`http://127.0.0.1:${PORT}`, "")}`);
  }
} finally {
  await browser.close();
  server.close();
  rmSync(WORK, { recursive: true, force: true });
}

say(failures === 0 ? "\nreceipt-ocr:verify passed" : `\nreceipt-ocr:verify FAILED — ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
