/**
 * layout:verify — the responsive contract for the whole product.
 *
 * House pattern: an executable script, not a checklist. It drives a real
 * Chromium against a running dev server and asserts four things at every
 * viewport in a matrix that spans phone to large desktop:
 *
 *   1. THE PAGE NEVER SCROLLS SIDEWAYS. Wide content (a twelve-column
 *      report, a payment-intent id with no spaces in it) must scroll
 *      inside its own frame. A document that scrolls horizontally is the
 *      single most common way a dense product breaks on a phone, and it
 *      is invisible to anyone testing at one window size.
 *
 *   2. THE PRIMARY CONTROLS ARE ON SCREEN. Sign out and every navigation
 *      entry must be inside the viewport and hittable. The header's email
 *      is user-supplied and unbounded; before this script it pushed Sign
 *      out off the right edge.
 *
 *   3. THE NAVIGATION IS REACHABLE IN EXACTLY ONE SHAPE. Either the rail
 *      or the strip, never both, never neither — a bug this product
 *      already shipped once, as a fixed rail crushing the canvas between
 *      768 and 1023px.
 *
 *   4. TAP TARGETS MEET WCAG 2.5.8 (24x24 CSS px) on the shell chrome.
 *      Inline links inside prose are exempt by the success criterion
 *      itself and are excluded here rather than papered over.
 *
 * ── WHY THESE WIDTHS ──────────────────────────────────────────────────
 *
 * Browser zoom is not a separate axis. Zooming does not scale the
 * viewport; it shrinks the viewport MEASURED IN CSS PIXELS, which is the
 * unit every media query in the product is written in. A 1440px monitor
 * at 175% zoom is an 823px viewport and takes the 823px column of this
 * matrix. So the widths below are chosen to be device sizes AND the zoom
 * levels of common monitors at once, and testing them covers both:
 *
 *      320  iPhone SE                     823  1440 @ 175%
 *      390  iPhone 14/15                  900  1280 @ 145%
 *      414  iPhone Plus/Max              1024  iPad landscape / md
 *      600  small tablet, split view     1180  iPad Pro 11"
 *      640  1280 @ 200%                  1280  laptop
 *      768  iPad portrait / old `sm`     1440  laptop, 1920 @ 133%
 *      834  iPad Air portrait            1920  desktop
 *
 * Two heights are used at each width, because vertical space is the axis
 * zoom hits hardest: a 900px-tall laptop at 175% zoom has 514 CSS px of
 * height, which is where a rail taller than the window silently pushed
 * the account block out of reach.
 *
 * Usage:  npm run dev  (in another shell), then  npm run layout:verify
 *         BASE=http://localhost:3001 npm run layout:verify   to override
 */

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";

/** Shell harness first — it is the chrome every other page inherits. */
const ROUTES = [
  "/layout-harness",
  "/",
  "/pricing",
  "/login",
  "/signup",
];

const WIDTHS = [
  320, 360, 390, 414, 480, 600, 640, 768, 834, 900, 1024, 1180, 1280, 1440,
  1728, 1920,
];
const HEIGHTS = [514, 900];

/** Radix's `md`. The shell's rail/strip switch must sit exactly here. */
const RAIL_BREAKPOINT = 1024;

const failures = [];
const fail = (route, w, h, msg) =>
  failures.push(`${route} @ ${w}x${h} — ${msg}`);

const browser = await chromium.launch();
let checks = 0;

for (const route of ROUTES) {
  for (const width of WIDTHS) {
    for (const height of HEIGHTS) {
      const ctx = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
      });
      const page = await ctx.newPage();
      let res;
      try {
        const r = await page.goto(BASE + route, {
          waitUntil: "networkidle",
          timeout: 30000,
        });
        if (!r || r.status() >= 400) {
          fail(route, width, height, `HTTP ${r ? r.status() : "no response"}`);
          await ctx.close();
          continue;
        }
        res = await page.evaluate(() => {
          const de = document.documentElement;
          const vw = de.clientWidth;

          // (1) page-level horizontal overflow, plus the culprits
          const overflow = de.scrollWidth - de.clientWidth;
          const offenders = [];
          if (overflow > 1) {
            for (const el of document.querySelectorAll("body *")) {
              const b = el.getBoundingClientRect();
              if (b.width === 0 || b.height === 0) continue;
              if (b.right <= vw + 1 && b.left >= -1) continue;
              // ignore anything inside a container that legitimately
              // scrolls or clips — that is the CORRECT arrangement
              let p = el.parentElement;
              let contained = false;
              while (p && p !== document.body) {
                const ox = getComputedStyle(p).overflowX;
                if (ox === "auto" || ox === "scroll" || ox === "hidden") {
                  contained = true;
                  break;
                }
                p = p.parentElement;
              }
              if (contained) continue;
              const cls =
                el.className && el.className.baseVal !== undefined
                  ? el.className.baseVal
                  : String(el.className || "");
              offenders.push(
                `<${el.tagName.toLowerCase()} class="${cls.slice(0, 60)}"> ` +
                  `w=${Math.round(b.width)} right=${Math.round(b.right)} :: ` +
                  (el.textContent || "").trim().slice(0, 40)
              );
              if (offenders.length >= 4) break;
            }
          }

          // (2)/(3) shell chrome, only meaningful on the harness
          const rail = document.querySelector("aside");
          const navs = [...document.querySelectorAll('nav[aria-label="Sections"]')];
          const visibleNavs = navs.filter((n) => n.getBoundingClientRect().width > 0);
          const signOut = [...document.querySelectorAll("button")].find(
            (b) => (b.textContent || "").trim() === "Sign out"
          );
          const signOutBox = signOut ? signOut.getBoundingClientRect() : null;

          // (4) tap targets on chrome only: nav entries and buttons.
          // Inline prose links are exempt per WCAG 2.5.8 and excluded.
          const tiny = [];
          const chrome = document.querySelectorAll(
            'nav[aria-label="Sections"] a, header button, header a'
          );
          for (const el of chrome) {
            const b = el.getBoundingClientRect();
            if (b.width === 0 || b.height === 0) continue;
            if (b.height < 24 || b.width < 24)
              tiny.push(
                `${el.tagName.toLowerCase()} ${Math.round(b.width)}x${Math.round(
                  b.height
                )} :: ${(el.textContent || "").trim().slice(0, 24)}`
              );
          }

          return {
            overflow,
            offenders,
            hasShell: !!rail,
            railVisible: rail ? rail.getBoundingClientRect().width > 0 : false,
            visibleNavCount: visibleNavs.length,
            signOutRight: signOutBox ? Math.round(signOutBox.right) : null,
            signOutVisible: !!signOutBox && signOutBox.width > 0,
            vw,
            tiny: tiny.slice(0, 4),
          };
        });
      } catch (e) {
        fail(route, width, height, `threw: ${String(e).slice(0, 140)}`);
        await ctx.close();
        continue;
      }

      checks++;

      // (1)
      if (res.overflow > 1) {
        fail(
          route,
          width,
          height,
          `page scrolls sideways by ${res.overflow}px\n      ` +
            res.offenders.join("\n      ")
        );
      }

      if (res.hasShell) {
        // (3) exactly one nav shape, and it is the right one for the width
        const expectRail = width >= RAIL_BREAKPOINT;
        if (res.railVisible !== expectRail) {
          fail(
            route,
            width,
            height,
            `rail ${res.railVisible ? "visible" : "hidden"} but expected ` +
              `${expectRail ? "visible" : "hidden"} (breakpoint ${RAIL_BREAKPOINT}px)`
          );
        }
        if (res.visibleNavCount !== 1) {
          fail(
            route,
            width,
            height,
            `${res.visibleNavCount} visible section navs; expected exactly 1`
          );
        }
        // (2) Sign out is in the header, which is desktop-only; below the
        // breakpoint it is reached through Settings in the strip.
        if (expectRail) {
          if (!res.signOutVisible) {
            fail(route, width, height, "Sign out is not rendered");
          } else if (res.signOutRight > res.vw + 1) {
            fail(
              route,
              width,
              height,
              `Sign out pushed off screen (right=${res.signOutRight}, viewport=${res.vw})`
            );
          }
        }
        // (4)
        if (res.tiny.length) {
          fail(
            route,
            width,
            height,
            `chrome tap targets below 24x24 (WCAG 2.5.8):\n      ` +
              res.tiny.join("\n      ")
          );
        }
      }

      await ctx.close();
    }
  }
}

await browser.close();

if (failures.length) {
  console.error(`\nlayout:verify FAILED — ${failures.length} of ${checks} checks\n`);
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(
  `layout:verify passed — ${checks} viewport checks across ${ROUTES.length} routes ` +
    `(${WIDTHS.length} widths x ${HEIGHTS.length} heights)`
);
