#!/usr/bin/env node
/**
 * Renders the PWA install icons from the brand kit's own vector source.
 *
 *   node scripts/generate-pwa-icons.mjs
 *
 * Input:  public/brand/app-icon.svg   (the V1 app-icon mark, 1024 viewBox,
 *                                      full-bleed background — the same
 *                                      source the kit's raster sizes came
 *                                      from)
 * Output: public/brand/pwa-icon-192.png
 *         public/brand/pwa-icon-512.png
 *
 * Both outputs are COMMITTED — this script is provenance, not a build
 * step. app/manifest.ts references the two files by path; nothing in the
 * build pipeline runs this. Re-run it only if the brand SVG changes, and
 * commit the regenerated PNGs with it.
 *
 * Why sharp: it is already in node_modules as Next.js's own image
 * optimizer dependency, so rendering the SVG here adds no dependency to
 * package.json. If sharp is ever absent (it is an optional install on
 * some platforms), this script fails loudly rather than emitting nothing.
 *
 * 192 and 512 are the two sizes the web app manifest spec's install
 * criteria ask for (Android home-screen and splash use); the kit already
 * shipped 1024/512 app-icon rasters but no 192, and the manifest wants a
 * self-consistent pair rendered from one source.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "public", "brand", "app-icon.svg");

let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch {
  console.error(
    "sharp is not installed — it normally ships with Next.js. Run `npm install` and retry."
  );
  process.exit(1);
}

for (const size of [192, 512]) {
  const out = join(root, "public", "brand", `pwa-icon-${size}.png`);
  // density scales the SVG rasterization so the vector is rendered AT the
  // target size rather than rendered small and resampled up.
  await sharp(source, { density: (72 * size) / 1024 })
    .resize(size, size)
    .png()
    .toFile(out);
  console.log(`wrote ${out}`);
}
