"use client";

/**
 * Catches a throw in the root layout itself, where error.tsx (which
 * renders inside the layout) can't help — this replaces <html>/<body>
 * entirely, so nothing from app/layout.tsx exists here: no theme
 * provider, no AppShell context, no stylesheet. That is why this file
 * uses no Material Dashboard components (they would throw without their
 * context/theme) and no styling at all — plain semantic HTML on browser
 * defaults is the only thing guaranteed to render on this path.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main>
          <h1>Something went wrong</h1>
          <p>The app failed to load.</p>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
