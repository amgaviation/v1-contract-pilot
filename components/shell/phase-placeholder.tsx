import { AppShell } from "@/components/shell/app-shell";
import { Panel } from "@/components/ui/panel";
import { DEMO_ACCOUNT } from "@/lib/mock-data";

/**
 * Every nav item in components/shell/rail-nav.tsx besides Overview points
 * here for now — without a page at each route, clicking any of them hit
 * Next's default 404 (no rail, no way back). Real content lands per the
 * build order in docs/PLAN.md; this keeps the nav honest until then.
 */
export function PhasePlaceholder({
  title,
  phase,
}: {
  title: string;
  phase: string;
}) {
  return (
    <AppShell accountName={DEMO_ACCOUNT.name} userName={DEMO_ACCOUNT.user}>
      <div className="v1-page-top">
        <div>
          <h1 className="v1-page-title">{title}</h1>
          <p className="v1-page-subtitle">Not built yet — see docs/PLAN.md, {phase}.</p>
        </div>
      </div>
      <Panel title={title}>
        <div className="v1-row">
          <span className="v1-row-detail">
            This section is scoped in the build plan but not implemented in this
            scaffold.
          </span>
        </div>
      </Panel>
    </AppShell>
  );
}
