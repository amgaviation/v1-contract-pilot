import type { ReactNode } from "react";
import { RailNav } from "@/components/shell/rail-nav";
import { BRAND } from "@/lib/brand";

/**
 * Wraps every authenticated screen: fixed left rail + main content +
 * footer. `accountName` / `userName` are passed in for now from static
 * demo data (see lib/mock-data.ts) — they'll come from the pilot's
 * session once Phase 1 (tenancy) and Phase 2 (auth) land.
 */
export function AppShell({
  children,
  accountName,
  userName,
}: {
  children: ReactNode;
  accountName: string;
  userName: string;
}) {
  return (
    <div className="v1-shell">
      <RailNav accountName={accountName} userName={userName} />
      <div className="v1-shell-body">
        <main className="v1-main">{children}</main>
        <footer className="v1-footer">{BRAND.attribution}</footer>
      </div>
    </div>
  );
}
