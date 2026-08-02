import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { DEMO_ACCOUNT } from "@/lib/mock-data";

/**
 * Without this file, an unmatched route falls through to Next's stock
 * 404 — no rail, no brand, no way back except the browser Back button,
 * since the nav itself is gone with it.
 */
export default function NotFound() {
  return (
    <AppShell accountName={DEMO_ACCOUNT.name} userName={DEMO_ACCOUNT.user}>
      <div className="v1-page-top">
        <div>
          <h1 className="v1-page-title">Not found</h1>
          <p className="v1-page-subtitle">
            There&rsquo;s nothing at this address. Pick a section from the left.
          </p>
        </div>
        {/* Link, not <Button><a>: nesting an <a> inside a <button> is
            invalid HTML (interactive content inside interactive content)
            — style the link directly with the button classes instead. */}
        <Link href="/" className="v1-btn v1-btn--primary">
          Back to overview
        </Link>
      </div>
    </AppShell>
  );
}
