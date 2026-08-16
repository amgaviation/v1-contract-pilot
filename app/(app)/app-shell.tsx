import Link from "next/link";
import { LAlert, LButton } from "@/components/ledger";
import { Logo } from "@/components/logo";
import { BRAND } from "@/lib/brand";
import { DASHBOARD_PATH } from "@/lib/nav";
import type { NavItem } from "@/lib/nav";
import type { ResolvedTheme } from "@/lib/theme-slots";
import { CommandPaletteProvider, CommandPaletteTrigger } from "./command-palette";
import { NavRail, NavStrip } from "./nav-rail";
import SkipLink from "./skip-link";

/**
 * THE AUTHENTICATED SHELL — chrome only, no data access. Restyled to
 * Ledger (docs/design/LEDGER.md, Phase 2 — "the moment the app *reads* as
 * Ledger"). See that file's migration table: un-migrated INSTRUMENT pages
 * keep rendering inside this shell for the rest of the migration window,
 * their white panels sitting on Ledger's paper canvas with their own
 * borders — an accepted, deliberate in-between state, not a bug.
 *
 * This is the markup that used to live inline in app/(app)/layout.tsx.
 * It was pulled out for one reason: the layout is behind requireAccount(),
 * so the shell could never be rendered without a real session and a real
 * tenant, which meant the responsive behaviour of EVERY page in the
 * product — the thing that decides what a pilot sees on a phone, on an
 * iPad in the FBO, and on a laptop at 150% browser zoom — was the one
 * part of the product with no way to test it. It got eyeballed, and it
 * drifted.
 *
 * Everything here is presentational and takes props. app/(app)/layout.tsx
 * does the session read and passes the results in; the layout harness
 * (app/(dev)/layout-harness, development-only) passes fixtures and is
 * measured across a width matrix by scripts/layout-verify.mjs. Both render
 * the SAME component, so the harness cannot pass while the product fails.
 *
 * If you add chrome, add it here, not in layout.tsx — otherwise it is
 * invisible to the verify script again.
 *
 * Styling is Ledger's Tailwind utilities against ledger.css's tokens only
 * — no `cx()`, no `i-*` classes, no `var()` in this file. The one INSTRUMENT
 * survivor is `.v1-nozoom-fields` (app/globals.css) on the root element,
 * kept deliberately: it targets un-migrated INSTRUMENT form fields inside
 * `children`, and it stays until the last one of those migrates (see the
 * className below).
 *
 * ── THE BREAKPOINT, AND WHY IT IS TAILWIND'S `lg` AND NOT `md` ───────────
 *
 * The rail switches on at `lg` (1024px), not `md` (768px, Tailwind's
 * default two-column threshold). Between 768 and 1023 a fixed 240px rail
 * in front of the canvas leaves the page narrower than the phone strip
 * layout gives at the SAME viewport, because there the whole width is the
 * page's. That band is not a rare edge: it is iPad portrait (768 and 834),
 * it is a split window on a laptop, and — the case that actually gets hit
 * daily — it is an ordinary 1280px or 1440px desktop at 150–175% browser
 * zoom. Browser zoom does not scale the viewport, it shrinks it measured
 * in CSS pixels: a 1440px monitor at 175% is an 823px viewport, which
 * lands squarely in the crushed band. Switching at 1024 means the cramped
 * two-column arrangement never exists at any width; below it you get the
 * full-width strip layout, which is the better of the two shapes there in
 * every case.
 *
 * 1024px is also the number this shell used under INSTRUMENT (that
 * system's own `md`, a custom scale position — lib/ds/scales.ts) and the
 * number scripts/layout-verify.mjs's width matrix is built around, so
 * nothing about WHAT switches or WHERE moved in this migration — only
 * which utility spells "1024" did. Tailwind's `lg` is a literal
 * `@media (min-width: 1024px)` with nothing configured to move it, so
 * every `lg:` in this file and in nav-rail.tsx switches in lockstep.
 */
export function AppShell({
  userEmail,
  accountName,
  sections,
  theme,
  readOnly,
  signOutAction,
  children,
}: {
  userEmail: string;
  accountName: string;
  sections: readonly NavItem[];
  theme: ResolvedTheme;
  readOnly: boolean;
  signOutAction: () => void | Promise<void>;
  children: React.ReactNode;
}) {
  // THE TENANT THEME, as three data attributes rather than a component —
  // unchanged mechanism, still the entire reason a tenant's light/dark,
  // accent and density choices apply to this subtree with no
  // component-level override anywhere below. Ledger's palette
  // (ledger.css) and INSTRUMENT's (tokens.css) are BOTH declared against
  // `[data-appearance]`, so the same attribute now drives two design
  // systems' night palettes at once — see LEDGER.md's "Day/night rides
  // the existing data-appearance attribute" note. `data-accent` and
  // `data-density` still matter too, but only to whatever INSTRUMENT
  // markup is still rendering inside `children`: ledger.css never reads
  // either one, restraint being the point (one accent, one indigo, no
  // per-tenant hue; density is a control-height concern INSTRUMENT forms
  // still need and Ledger's own forms, arriving Phase 4, will not).
  //
  // There is no longer a second, nested `data-appearance="dark"` anywhere
  // in this file. INSTRUMENT's rail was deliberately forced dark
  // regardless of the tenant's own choice — "the product's one dark
  // surface" — and that forcing is gone: the rail is a Ledger surface now,
  // so it simply inherits whichever appearance is stamped here, the same
  // as everything else in the subtree.
  return (
    // Wraps the shell's own content rather than being mounted inside it.
    // The dialog, its open state and its ⌘K listener all live in
    // command-palette.tsx's CommandPaletteProvider — see that file's
    // header comment for why one provider high up the tree, rather than
    // either trigger owning its own copy, is what keeps this a single
    // dialog no matter how many CommandPaletteTrigger's render below it.
    // A client component rendering server-rendered content passed to it
    // as `children` does not pull that content across the server/client
    // boundary, so this stays a server component with no "use client" of
    // its own.
    <CommandPaletteProvider sections={sections}>
      {/* THE CANVAS SWAP. Everything from here down paints Ledger's paper
          ground (`bg-canvas`) and ink (`text-ink`), not INSTRUMENT's cream
          `--canvas`. An un-migrated INSTRUMENT page rendered inside `main`
          below still paints its own white Card panels with their own
          borders — those sit ON this ground rather than blending into it,
          which is the accepted look for the rest of the migration window
          (LEDGER.md, Phase 2's own note).

          100dvh, not 100vh. On mobile Safari and Chrome, 100vh is the
          viewport with the URL bar RETRACTED, so a page that exactly
          fills the screen is ~60-90px taller than the screen actually
          showing: every screen in the product had a scroll nub on a
          phone even when it had nothing to scroll, and the footer sat
          under the browser chrome. dvh is the dynamic viewport height —
          the real one, now, whichever way the bar is. */}
      <div
        className="v1-nozoom-fields flex min-h-dvh flex-col bg-canvas font-ledger text-ink lg:flex-row"
        data-appearance={theme.appearance}
        data-accent={theme.accent}
        data-density={theme.density}
      >
        <SkipLink />

        {/* The narrow-width top bar — logo plus a horizontally scrolling
            section strip. Always rendered (never conditionally mounted):
            only `display` toggles across the breakpoint (`block`/
            `lg:hidden`), so switching pages never adds or removes these
            nodes and never shifts layout.

            Sticky, like the desktop header is. On a phone the strip IS
            the navigation — leaving it to scroll away meant that getting
            from the bottom of a long invoice list to another section was
            a scroll to the top first.

            Translucent + blurred (`bg-canvas/80` + `backdrop-blur`) rather
            than an opaque bar with a rule: content genuinely scrolls
            UNDER this bar, so a hard edge would assert a boundary that
            is not there. `border-b border-hair` supplies the hairline
            Ledger uses in place of INSTRUMENT's `--edge`-bordered
            `.i-chrome` token. */}
        <div className="sticky top-0 z-[2] block lg:hidden">
          <div className="border-b border-hair bg-canvas/80 backdrop-blur">
            <div className="flex items-center justify-between gap-2 px-3 pt-3">
              <div className="flex items-center gap-2">
                <Link
                  href={DASHBOARD_PATH}
                  aria-label={`${BRAND.name}: ${BRAND.descriptor}`}
                >
                  <Logo />
                </Link>
                {/* The phone entry point to the command palette. The
                    desktop header carrying the other one (below, in this
                    file) is hidden at this width, and there is no
                    physical ⌘/Ctrl key here for the keyboard shortcut
                    either — without this, search had no way in on a
                    phone at all. Lives in THIS row, beside the logo,
                    rather than inside NavStrip below: NavStrip is a
                    horizontally-scrolling strip of equal-priority section
                    links, and a control that is not a section would
                    either eat into that scroll area or force it to wrap,
                    so this costs the strip nothing. This button's OWN
                    styling is not this file's to restyle — it is a
                    CommandPaletteTrigger, owned by command-palette.tsx —
                    only the row it sits in is Ledger's. */}
                <CommandPaletteTrigger variant="icon" />
              </div>
              {/* The only Sign out control reachable below `lg` — the
                  desktop header carrying it is hidden at this width (see
                  the header's own comment), and Settings offers only
                  "Sign out other devices", which explicitly preserves
                  THIS session. Without this, a pilot on a shared or
                  borrowed device — the primary persona's own daily
                  reality — had no way to end their session on a phone or
                  an iPad in portrait. A form, not a link, for the same
                  reason the desktop one is: signing out mutates session
                  state, and a GET a prefetcher can fire would end the
                  session behind the pilot's back. `size="sm"` computes to
                  32px high (`components/ledger`'s LButton), clearing the
                  24px WCAG 2.5.8 (AA, Target Size Minimum) floor measured
                  by scripts/layout-verify.mjs. */}
              <form action={signOutAction}>
                <LButton type="submit" variant="outline" size="sm" className="shrink-0">
                  Sign out
                </LButton>
              </form>
            </div>
            <NavStrip sections={sections} />
          </div>
        </div>

        {/* THE RAIL LEAVES THE DARK (LEDGER.md, Phase 2). In day mode this
            is a light structural surface — `bg-sunk`, one step off the
            canvas, with a right hairline — rather than INSTRUMENT's
            permanent dark panel. At night it simply follows the same
            `data-appearance="dark"` stamped on the shell root above,
            same as every other Ledger surface in the subtree; there is
            no second, forced palette nested inside it any more. See
            nav-rail.tsx's own header comment for the full reasoning. */}
        <aside
          className="hidden border-r border-hair bg-sunk lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:shrink-0 lg:flex-col lg:overflow-y-auto"
        >
          <div className="p-4">
            <Link
              href={DASHBOARD_PATH}
              aria-label={`${BRAND.name}: ${BRAND.descriptor}`}
            >
              {/* Wordmark auto-inverts to white on a dark ground —
                  app/globals.css's `[data-appearance="dark"]` rule, keyed
                  off the SAME attribute the shell root stamps. Still
                  correct with no nested dark wrapper here, because that
                  rule already matches any dark-appearance subtree, not
                  specifically a nested one. */}
              <Logo />
            </Link>
            <div className="mt-1 text-caption text-ink-3">
              {BRAND.descriptor}
            </div>
          </div>
          <NavRail accountName={accountName} sections={sections} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Sticky, translucent + blurred like the phone bar above — the
              same floating-chrome treatment, restyled to Ledger
              (`bg-canvas/80` + `backdrop-blur` in place of INSTRUMENT's
              `--chrome-blur` token; `border-b border-hair` for the
              hairline). z-[1] keeps it above the canvas but below the
              skip link (z-[1000]).

              The nav rail deliberately does NOT get this treatment: it
              is a full-height structural region, and the same
              distinction Apple draws for its own materials holds here —
              heavy, opaque surfaces separate structure (the rail, solid
              `bg-sunk`); light, translucent ones float over content that
              scrolls under them (this header, the phone strip).

              Hidden below `lg`: at phone and tablet-portrait widths the
              sticky section strip is already occupying the top of the
              screen, and stacking a second sticky bar under it spent
              ~40px of a 640px-tall phone screen on an email address. The
              email is not repeated below `lg` (Settings' "Profile &
              security" panel shows it), but Sign out itself is — the
              phone top bar above carries its own copy of the same form,
              because Settings only offers "Sign out other devices",
              which explicitly preserves this one. */}
          <header className="sticky top-0 z-[1] hidden items-center justify-end gap-3 border-b border-hair bg-canvas/80 px-4 py-2 backdrop-blur lg:flex">
            {/* min-w-0 + truncate: an email is user-supplied and
                unbounded, and a flex item will not shrink below its
                content without it. A long address pushed the Sign out
                button off the right edge of the header — the one
                control on the shell that must never be unreachable. */}
            <div className="min-w-0 overflow-hidden">
              <div className="truncate text-caption text-ink-3" title={userEmail}>
                {userEmail}
              </div>
            </div>
            {/* The desktop entry point to the command palette — one of
                two now; the phone top bar above carries the other (see
                its own comment). Both open the SAME dialog: see
                command-palette.tsx's header comment for why splitting
                the trigger from the provider is what keeps that true
                rather than this being a second copy of it. `sections`
                still travels as the SAME server-filtered prop passed to
                NavRail/NavStrip above (nav-rail.tsx's header comment:
                the currency-flag filter runs server-side, before this
                prop exists), so neither trigger can ever offer a pilot a
                section their tenant does not have. This button's OWN
                styling is command-palette.tsx's to own, not this file's
                — only the header row around it is Ledger's. */}
            <CommandPaletteTrigger />
            {/* A form, not a link: signing out mutates session state, and
                a GET that a prefetcher or a link-scanner can fire would
                end the session behind the pilot's back. `size="sm"`, same
                WCAG 2.5.8 floor as the phone bar's copy above. */}
            <form action={signOutAction}>
              <LButton type="submit" variant="outline" size="sm" className="shrink-0">
                Sign out
              </LButton>
            </form>
          </header>

          {/* The canvas: Ledger's paper ground behind every page, so an
              un-migrated INSTRUMENT Card (white, its own border) or a
              migrated Ledger LCard (`bg-card` + `shadow-card`) both read
              as a panel sitting on it — the same canvas-and-panel
              hierarchy the product has always had, now painted in
              Ledger's tokens instead of INSTRUMENT's. */}
          <main
            id="main-content"
            tabIndex={-1}
            className="min-w-0 flex-1 bg-canvas p-3 font-ledger text-ink sm:p-4 lg:p-5"
          >
            {/* Was a hard 1136px cap at every width. This product is
                data-dense by design — the year-end packet, trip P&L and
                pilot-history reports are ten- and twelve-column tables —
                and on a 1728px or 1920px monitor that cap left ~550px of
                empty canvas beside a table that was scrolling
                horizontally inside its own frame. A pilot with a big
                screen should get to USE it. The ladder keeps the narrow
                measure where it helps (a settings form at 1136px is
                already at the edge of comfortable line length) and only
                opens up on screens that have the room. The three
                thresholds (1024 / 1280 / 1640) are the same three this
                shell always used; the last has no matching named Tailwind
                breakpoint, so it is spelled as an arbitrary variant to
                keep the exact number rather than rounding to the nearest
                one Tailwind ships. */}
            <div className="mx-auto min-w-0 max-w-full lg:max-w-[1136px] xl:max-w-[1280px] min-[1640px]:max-w-[1536px]">
              {readOnly ? (
                <div className="mb-4">
                  <LAlert tone="warn">
                    Your subscription has ended, so this account is
                    read-only. Everything stays viewable and exportable,
                    and nothing is deleted. Reading and export still work;
                    resubscribe to make changes again.{" "}
                    <Link
                      href="/settings/billing"
                      className="font-medium text-accent underline underline-offset-2 hover:opacity-80"
                    >
                      Go to Billing
                    </Link>
                    .
                  </LAlert>
                </div>
              ) : null}
              {children}
            </div>
          </main>

          <div className="px-3 py-4 lg:px-5">
            <hr className="mb-4 border-0 border-t border-hair" />
            {/* The one place AMG is named in the whole product — decision
                #18. Not the rail, not the header, never an invoice PDF. */}
            <div className="text-caption text-ink-3">{BRAND.attribution}</div>
          </div>
        </div>
      </div>
    </CommandPaletteProvider>
  );
}
