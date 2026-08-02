const VARIANT_CLASS = {
  ok: "v1-tag v1-tag--ok",
  bad: "v1-tag v1-tag--bad",
  warn: "v1-tag v1-tag--warn",
  neutral: "v1-tag v1-tag--neutral",
} as const;

export type StatusVariant = keyof typeof VARIANT_CLASS;

export function StatusTag({
  variant,
  children,
}: {
  variant: StatusVariant;
  children: React.ReactNode;
}) {
  return <span className={VARIANT_CLASS[variant]}>{children}</span>;
}
