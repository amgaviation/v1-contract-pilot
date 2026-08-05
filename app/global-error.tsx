"use client";

// Catches a throw in the root layout itself, where error.tsx (which
// renders inside the layout) can't help — this replaces <html>/<body>
// entirely, so it does NOT inherit app/layout.tsx's stylesheet import.
// Importing it directly here (rather than reaching for inline styles,
// which would defeat the token-discipline rule this codebase otherwise
// holds everywhere else) means this page still renders on the base
// styles from the token layer (app/base.css + app/components.css).
import "./globals.css";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div className="v1-main">
          <h1 className="v1-page-title">Something went wrong</h1>
          <p className="v1-page-subtitle">The app failed to load.</p>
          <button className="v1-btn v1-btn--primary" type="button" onClick={reset}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
