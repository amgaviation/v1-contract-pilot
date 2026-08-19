import { cn } from "@/lib/ledger/cn";
import { BRAND } from "@/lib/brand";

/**
 * A PRODUCT SCREENSHOT ON THE PUBLIC PAGE.
 *
 * These are REAL captures of the real screens, not drawings of them: the
 * PNGs in public/marketing/ are written by scripts/marketing-shots.mjs,
 * which drives Chromium against app/(dev)/marketing-shots — a
 * development-only harness that renders the product's own <AppShell> around
 * the product's own components. Read that harness's header before adding a
 * shot; it sets out which screens are the real components (invoices,
 * logbook) and which is a re-composition of the same primitives (overview),
 * and why.
 *
 * EVERY FIGURE, NAME, REGISTRATION AND AMOUNT IN THESE IMAGES IS INVENTED —
 * see app/(dev)/marketing-shots/fixtures.ts. There is no customer in any of
 * them, which is why each carries its own "Illustrative data." caption
 * rather than relying on one disclaimer somewhere else on the page.
 *
 * ── THE THREE THINGS THIS COMPONENT EXISTS TO GET RIGHT ───────────────
 *
 * ALT TEXT THAT DESCRIBES THE SCREEN. Not "screenshot of the dashboard" —
 * what is actually on it, in the order a reader would meet it, because for
 * anyone using a screen reader this text IS the figure. It names the
 * product through BRAND.name rather than spelling it, the same rule the
 * rest of the codebase follows.
 *
 * WIDTH AND HEIGHT, ALWAYS. The intrinsic pixel size of each PNG is twice
 * its capture size (deviceScaleFactor 2), and the attributes below state
 * the CSS-pixel capture size — what matters is the RATIO, which is what
 * the browser uses to reserve the box before the bytes arrive. Without it
 * the page reflows as each image lands.
 *
 * A PLAIN <img>, NOT next/image. Same call as the three other image sites
 * in this codebase (site-header.tsx, auth-brand.tsx, app-shell.tsx), and
 * next.config.ts's own comment records that nothing here imports
 * next/image: these are static, already-compressed assets served from
 * public/ at one size, so the optimizer has nothing to add and would add a
 * per-request hop to do it.
 */

export type ShotSlug = "overview" | "invoice" | "logbook";

type Shot = {
  src: string;
  /** CSS-pixel capture size. The PNG itself is twice this, at 2x. */
  width: number;
  height: number;
  alt: string;
};

const SHOTS: Record<ShotSlug, Shot> = {
  overview: {
    src: "/marketing/overview.png",
    width: 1440,
    height: 790,
    alt:
      `The ${BRAND.name} Overview screen. Two grouped money cards: "Owed to you" ` +
      `shows $11,634.00 of unbilled work across 3 completed trips and $9,150.00 ` +
      `awaiting payment on 2 invoices; "This calendar year" shows $146,900.00 paid ` +
      `and $12,865.40 of deductible expenses. Below them, a table of unbilled money ` +
      `by client with a total row, and a "Ready to invoice" list of three trips with ` +
      `their routes, tail numbers, dates and amounts. Illustrative data.`,
  },
  invoice: {
    src: "/marketing/invoice.png",
    width: 1440,
    height: 940,
    alt:
      `A sent invoice in ${BRAND.name}, numbered INV-2026-0184 and due Sep 7, 2026. ` +
      `Its five lines came off one trip: three flight days at $1,350.00, a travel ` +
      `day, four days of per diem, and two rebilled receipts, totalling $6,123.50 ` +
      `still due. Panels alongside offer a reminder, a client link that opens the ` +
      `invoice without an account, and a card-or-bank payment link. Illustrative data.`,
  },
  logbook: {
    src: "/marketing/logbook.png",
    width: 1440,
    height: 952,
    alt:
      `The ${BRAND.name} logbook. Career totals across the top — 8,412.6 hours total, ` +
      `5,187.3 PIC, 1,104.8 night, 612.4 instrument, 214.0 simulator and 5,312 ` +
      `landings, each counted separately. Then hours by aircraft type, and a table of ` +
      `flights with one entry per leg: date, route, tail number, PIC or SIC, times and ` +
      `landings, each badged with whether it was drafted from a trip, typed by hand or ` +
      `imported. Illustrative data.`,
  },
};

export default function ProductShot({
  slug,
  priority = false,
  className,
}: {
  slug: ShotSlug;
  /** The hero shot only: it is above the fold, so it must not lazy-load. */
  priority?: boolean;
  className?: string;
}) {
  const shot = SHOTS[slug];
  return (
    // data-mock, exactly as the retired hand-built mock carried it: this
    // subtree is illustrative data rather than copy, and docs/MARKETING.md
    // §6's word-budget measurement drops it. Nothing styles off it.
    //
    // THE TRAY (2026-08-19 reskin): every capture sits in the double-bezel
    // shell from app/design/marketing.css — an outer machined rim, an
    // inner core with its own hairline and a concentric radius. On the
    // dark surface the light UI inside reads as a lit screen in a panel,
    // which is the honest version of the effect: it IS the product's
    // actual screen. The old onBrand branch (shadow choice against navy
    // vs paper) died with the light surface — there is one ground now.
    <figure data-mock="product" className={cn("m-0 flex flex-col gap-2", className)}>
      <div className="mkt-tray">
        <div className="mkt-tray-core">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shot.src}
            alt={shot.alt}
            width={shot.width}
            height={shot.height}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            // max-w-full is what keeps a 1440px-wide asset from setting the
            // page's min-content width on a 320px phone — the one way an
            // image alone can make the whole document scroll sideways.
            className="block h-auto w-full max-w-full"
          />
        </div>
      </div>
      <figcaption className="pl-1.5 text-caption text-ink-3">
        Illustrative data.
      </figcaption>
    </figure>
  );
}
