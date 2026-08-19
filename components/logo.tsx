import NextLink from "next/link";
import { BRAND } from "@/lib/brand";

/**
 * The V1 mark. Geometry from the logo kit's `svg9/v1-logo-light.svg`,
 * inlined verbatim (Barlow 600 converted to outlines — no font dependency).
 *
 * One SVG, not two: both fills are CSS custom properties
 * (`--v1-logo-mark` / `--v1-logo-bug`, defined in app/globals.css — the
 * retired token layer's only survivors). The kit fixes the wordmark at
 * literal black/white and the bug at one blue on every ground: these are
 * brand-identity constants, not theme tokens, which is why they live as
 * plain CSS custom properties rather than being wired to the Radix
 * accent scale (a future accent change must never retint the trademark
 * artwork). The app's <Theme> in app/layout.tsx is currently pinned
 * appearance="light", so only the light-ground value of
 * --v1-logo-mark ever actually renders — but app/globals.css also
 * carries the dark-ground value (`#ffffff`) for the day that pin comes
 * off, under selectors matching every mechanism that could plausibly set
 * dark mode (see that file's comment for which ones). There is no
 * Material Dashboard "Configurator toggle" in this product; that kit was
 * removed in the Radix rebuild.
 *
 * Per the kit's construction spec: don't recolor anything but the bug,
 * don't move it, don't add graduations below 80px, minimum size 16px.
 *
 * `href` makes the mark a link — added for the four tokenized client
 * surfaces (invoice/estimate/packet/vendor and their 404s), where the mark
 * was the only brand element on screen and linked nowhere: an operator's
 * AP desk asked to click "Pay online" had no way, in any number of clicks,
 * to find out what V1 is. Deliberately opt-in per call site: the in-app
 * rail's mark stays inert, as before.
 */
export function Logo({ className, href }: { className?: string; href?: string }) {
  if (href) {
    return (
      <NextLink href={href} className={className ? `v1-logo ${className}` : "v1-logo"}>
        <LogoArt />
      </NextLink>
    );
  }
  return (
    <span className={className ? `v1-logo ${className}` : "v1-logo"}>
      <LogoArt />
    </span>
  );
}

function LogoArt() {
  return (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 153.268 100.000"
        role="img"
        aria-label={BRAND.wordmark}
      >
        <g transform="translate(-4.2857,-0.0000) scale(1.000000)">
          <path
            fill="var(--v1-logo-mark)"
            d="M34.42857142857142 98.57142857142857 4.428571428571428 2.0 4.285714285714286 1.4285714285714306Q4.285714285714286 0.0 5.857142857142857 0.0H20.0Q21.57142857142857 0.0 22.0 1.4285714285714306L43.42857142857142 76.0Q43.57142857142857 76.42857142857143 43.857142857142854 76.42857142857143Q44.14285714285714 76.42857142857143 44.285714285714285 76.0L65.57142857142857 1.4285714285714306Q66.0 0.0 67.57142857142857 0.0H81.42857142857143Q82.28571428571428 0.0 82.71428571428571 0.5714285714285765Q83.14285714285714 1.142857142857153 82.85714285714285 2.0L52.42857142857142 98.57142857142857Q52.0 100.0 50.57142857142857 100.0H36.285714285714285Q34.857142857142854 100.0 34.42857142857142 98.57142857142857Z"
          />
          <path
            fill="var(--v1-logo-mark)"
            d="M115.14285714285714 0.0H128.85714285714286Q129.57142857142856 0.0 130.07142857142856 0.5Q130.57142857142856 1.0 130.57142857142856 1.7142857142857224V98.28571428571429Q130.57142857142856 99.0 130.07142857142856 99.5Q129.57142857142856 100.0 128.85714285714286 100.0H115.71428571428571Q115.0 100.0 114.5 99.5Q114.0 99.0 114.0 98.28571428571429V17.142857142857153Q114.0 16.85714285714286 113.71428571428571 16.642857142857146Q113.42857142857142 16.42857142857143 113.14285714285714 16.57142857142857L98.85714285714285 21.0Q98.57142857142857 21.142857142857153 98.14285714285714 21.142857142857153Q97.57142857142857 21.142857142857153 97.21428571428571 20.714285714285722Q96.85714285714285 20.285714285714292 96.85714285714285 19.57142857142857L96.42857142857143 10.142857142857153Q96.42857142857143 8.714285714285722 97.57142857142857 8.142857142857153L113.0 0.4285714285714306Q114.14285714285714 0.0 115.14285714285714 0.0Z"
          />
          <path fill="var(--v1-logo-bug)" d="M 130.554 33.000 L 157.554 21.120 L 157.554 44.880 Z" />
        </g>
      </svg>
  );
}
