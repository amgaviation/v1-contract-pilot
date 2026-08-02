export function KpiTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="v1-kpi">
      <div className="v1-kpi-label">{label}</div>
      <div className="v1-kpi-value">{value}</div>
      <div className="v1-kpi-sub">{sub}</div>
    </div>
  );
}
