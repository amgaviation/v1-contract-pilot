import LoadingPanel from "../loading-panel";

// dashboard: the four KPI cards plus a panel, so the money row's height is
// reserved before the figures land (see loading-panel.tsx).
export default function Loading() {
  return <LoadingPanel label="your overview" shape="dashboard" />;
}
