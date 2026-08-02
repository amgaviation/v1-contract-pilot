"use client";

import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { DEMO_ACCOUNT } from "@/lib/mock-data";

/**
 * Route-level error boundary. Without this, an unhandled throw in any
 * Server Component under this layout falls through to Next's default
 * error page — no brand, no rail, no recovery affordance. Next.js
 * requires error.tsx to be a Client Component.
 */
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AppShell accountName={DEMO_ACCOUNT.name} userName={DEMO_ACCOUNT.user}>
      <div className="v1-page-top">
        <div>
          <h1 className="v1-page-title">Something went wrong</h1>
          <p className="v1-page-subtitle">
            That didn&rsquo;t load. Try again, or head back to the overview.
          </p>
        </div>
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
      </div>
    </AppShell>
  );
}
