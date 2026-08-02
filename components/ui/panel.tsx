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
        {/* h2: lets a screen-reader user navigate the several panels on a
            dashboard by heading, which is how assistive tech skims one.
            .v1-panel-header h2 keeps it visually identical to a label. */}
        <h2>{title}</h2>
        {/* Plain span, not <em>: this was purely a style hook, but <em>
            carries real semantic emphasis that a screen reader announces
            regardless of the font-style: normal this rule used to apply. */}
        {context ? <span className="v1-panel-context">{context}</span> : null}
      </div>
      {children}
    </div>
  );
}
