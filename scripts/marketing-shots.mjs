#!/usr/bin/env node
/**
 * marketing:shots — the landing page's product screenshots, captured from
 * the product.
 *
 * House pattern, same as scripts/layout-verify.mjs: an executable script,
 * not a checklist. It drives a real Chromium against a running dev server
 * and photographs app/(dev)/marketing-shots — the development-only harness
 * that renders the REAL <AppShell> around real product screens filled with
 * entirely invented data. Read that harness's header before changing
 * anything here; in particular, which screens are the real components and
 * which one is a re-composition is stated there, not guessed at.
 *
 * The output lands in public/marketing/ and is committed, because the
 * landing page ships it: a build has no dev server to photograph.
 *
 * WHY VIEWPORT SHOTS AND NOT fullPage. These are figures on a marketing
 * page, sized to a column. A full-page capture of Overview is a very tall,
 * very thin image that has to be scaled to illegibility to fit anywhere —
 * so each screen declares the viewport it is photographed at, and the
 * capture is exactly that rectangle: the top of the screen, at the shape
 * the page can actually carry.
 *
 * WHY deviceScaleFactor 2. A 1x capture displayed at the same CSS width on
 * any modern screen is visibly soft, and the whole point of using real
 * screens is that the numbers on them are readable.
 *
 * Usage:  npm run dev  (in another shell), then  npm run marketing:shots
 *         BASE=http://localhost:3001 npm run marketing:shots   to override
 */

import { chromium } from "playwright";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT_DIR = join(process.cwd(), "public", "marketing");

/**
 * The bundled Playwright browser download is not present in every
 * environment this runs in (and fetching one is blocked in some), so the
 * pre-installed Chromium is used by path when it exists. Overridable for a
 * machine that keeps its browsers somewhere else.
 */
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

/**
 * One entry per PNG. `width`/`height` are CSS pixels — the capture is that
 * rectangle at 2x, so the file is twice each number.
 *
 * The widths are all 1440: the app shell's rail switches on at 1024 and its
 * canvas opens to 1280 at `xl`, so 1440 is the narrowest width that shows
 * the product in its full desktop arrangement rather than a squeezed one.
 * The heights differ per screen and are chosen so the capture ends on a
 * panel boundary rather than slicing a table row in half.
 */
const SHOTS = [
  { slug: "overview", route: "/marketing-shots/overview", width: 1440, height: 790 },
  { slug: "invoice", route: "/marketing-shots/invoices", width: 1440, height: 940 },
  { slug: "logbook", route: "/marketing-shots/logbook", width: 1440, height: 952 },
];

/**
 * Motion off, caret off. A capture taken mid-transition is a different
 * image every run, which turns a re-capture into a meaningless diff.
 */
const FREEZE_CSS = `
  *, *::before, *::after {
    transition-duration: 0s !important;
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    caret-color: transparent !important;
  }
  /* THE DEV OVERLAY MUST NOT BE IN A MARKETING IMAGE. These shots are
     necessarily taken against \`next dev\` — the harness route 404s in any
     other mode — and Next renders its dev-tools indicator into a
     <nextjs-portal> custom element floating at the bottom-left. It baked a
     dark circular badge over the account name in the first captured set.
     Hidden here rather than by a next.config change, because this is a
     property of the SCREENSHOT, not of how the app should run. */
  nextjs-portal,
  [data-nextjs-toast],
  [data-nextjs-dev-tools-button],
  #__next-build-watcher {
    display: none !important;
  }
`;

/**
 * PALETTE-QUANTISE THE PNG BEFORE IT LANDS.
 *
 * A 2880px-wide 24-bit capture of a product screen is ~460 KB, and these
 * files ship to every visitor of the landing page. A screenshot of a
 * fintech register is a few dozen flat colours plus antialiased text, which
 * is exactly the input an 8-bit palette encodes losslessly to the eye — it
 * takes the same images to ~90–170 KB with no visible change to the
 * figures, which are the whole reason for capturing at 2x.
 *
 * sharp is Next's own optional image dependency rather than something this
 * repo declares, so this is written to DEGRADE rather than fail: no sharp,
 * or an encode that throws, and the raw capture is written with a warning.
 * A bigger file is a worse outcome, not a broken one.
 */
async function compress(png) {
  try {
    const { default: sharp } = await import("sharp");
    return await sharp(png).png({ palette: true, quality: 90, effort: 10 }).toBuffer();
  } catch {
    return null;
  }
}

const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
await mkdir(OUT_DIR, { recursive: true });

const written = [];
const failures = [];

for (const shot of SHOTS) {
  const ctx = await browser.newContext({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: 2,
    // The harness renders the shell's default theme; forcing the media
    // feature keeps a machine in dark mode from producing a different PNG.
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  try {
    const res = await page.goto(BASE + shot.route, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    if (!res || res.status() >= 400) {
      failures.push(
        `${shot.route} — HTTP ${res ? res.status() : "no response"}. Is the dev ` +
          `server running, and is NODE_ENV development? The harness 404s outside it.`
      );
      await ctx.close();
      continue;
    }
    await page.addStyleTag({ content: FREEZE_CSS });
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot({ type: "png" });
    const squeezed = await compress(png);
    if (!squeezed) {
      console.warn(
        `  ! ${shot.slug}: sharp unavailable, writing the raw 24-bit capture ` +
          `(several times larger than it needs to be).`
      );
    }
    const file = join(OUT_DIR, `${shot.slug}.png`);
    await writeFile(file, squeezed ?? png);
    const { size } = await stat(file);
    written.push({ file, slug: shot.slug, size, shot });
  } catch (e) {
    failures.push(`${shot.route} — threw: ${String(e).slice(0, 200)}`);
  }
  await ctx.close();
}

await browser.close();

if (failures.length) {
  console.error(`\nmarketing:shots FAILED — ${failures.length} of ${SHOTS.length}\n`);
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}

for (const w of written) {
  console.log(
    `  ${w.slug}.png  ${w.shot.width}x${w.shot.height} @2x ` +
      `(${w.shot.width * 2}x${w.shot.height * 2})  ${(w.size / 1024).toFixed(0)} KB`
  );
}
console.log(
  `marketing:shots wrote ${written.length} file(s) to public/marketing/. ` +
    `The intrinsic size of each PNG is twice its CSS capture size — the ` +
    `landing page's width/height attributes must state the CSS size.`
);
