import type { Viewport } from "next";
import "@/app/design/marketing.css";
import { BRAND, MARKETING_THEME_COLOR } from "@/lib/brand";
import { AuthPanel, AuthMobileBar, AuthBackLink } from "./auth-brand";

/**
 * THE SIGNED-OUT SURFACE — /signup, /login, /forgot-password,
 * /reset-password, /check-email, /link-expired, /welcome. Each page still
 * does its own session check; this file is composition only.
 *
 * REDESIGNED 2026-08-19 (owner's direction): the old shell was one
 * narrow column whose whole brand presence was a 36px badge, and only
 * /signup carried a brand panel — inside its own component. The shell is
 * now the marketing site's sibling: a full-height navy brand column
 * (auth-brand.tsx's AuthPanel, carrying the story the signup panel
 * carried, strings moved verbatim) beside the form column, folding to a
 * navy bar on a phone so the form stays first. Forms sit in the
 * marketing tray (auth-parts.tsx's AuthCard) rather than a bare card.
 *
 * THE `.mkt` SCOPE is what makes the craft classes (.mkt-glow,
 * .mkt-tray) resolve here — app/design/marketing.css remaps NO tokens,
 * so stamping it costs nothing beyond enabling those classes; the
 * surface still stands on Ledger's own day palette with the navy
 * carried by the brand tokens.
 *
 * The tagline renders once per viewport: the panel's bottom line at lg+,
 * a quiet close under the form column below it. BRAND.attribution stays
 * off this surface entirely (lib/brand.ts confines it).
 *
 * .v1-nozoom-fields SURVIVES ON PURPOSE: pure touch-device font-sizing,
 * not a value tokens:verify polices — see app/globals.css.
 */

/** The phone's browser chrome meets the navy bar, same as the marketing
 *  pages — one surface, one tint. */
export const viewport: Viewport = {
  themeColor: MARKETING_THEME_COLOR,
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mkt v1-nozoom-fields min-h-dvh bg-canvas font-ledger text-body text-ink lg:grid lg:grid-cols-[minmax(0,4fr)_minmax(0,5fr)]">
      <AuthPanel />

      <div className="flex min-h-dvh flex-col lg:min-h-0">
        <AuthMobileBar />

        <div className="flex flex-1 flex-col gap-4 px-4 py-8 sm:px-8 sm:py-10">
          <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4">
            <div className="hidden lg:flex lg:justify-end">
              <AuthBackLink />
            </div>

            {/* The form takes the leftover height and centers itself in
                it, so a short form (reset password) sits optically
                centered while a tall one (signup) simply grows downward. */}
            <div className="flex flex-1 flex-col justify-center">
              {children}
            </div>

            <p className="text-caption text-ink-3 lg:hidden">
              {BRAND.tagline}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
