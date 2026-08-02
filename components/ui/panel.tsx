import type { ReactNode } from "react";

export function Panel({
  title,
  context,
  warn,
  children,
}: {
  title: string;
  context?: string;
  warn?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={warn ? "v1-panel v1-panel--warn" : "v1-panel"}>
      <div className="v1-panel-header">
        <span>{title}</span>
        {context ? <em>{context}</em> : null}
      </div>
      {children}
    </div>
  );
}
