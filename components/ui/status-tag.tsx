const VARIANT_CLASS = {
  ok: "v1-tag v1-tag--ok",
  bad: "v1-tag v1-tag--bad",
  warn: "v1-tag v1-tag--warn",
  neutral: "v1-tag v1-tag--neutral",
} as const;

/**
 * The glyph carries the level without hue: filled circle for normal,
 * triangle for caution, square for warning, hollow circle for a state
 * that needs no action. This is what keeps the three-level annunciator
 * scale readable in greyscale, on a photocopy, and to any form of colour
 * vision deficiency — the chip's soft tint alone would not survive any
 * of those.
 *
 * They are typographic characters set in the body face, not icons, and
 * not the beginning of an icon system: this product deliberately has
 * neither (see docs/DESIGN-SYSTEM.md). aria-hidden because the word
 * beside them already carries the same meaning, and a screen reader
 * announcing "black circle, Current" is noise.
 */
const GLYPH = {
  ok: "●",
  warn: "▲",
  bad: "■",
  neutral: "○",
} as const;

export type StatusVariant = keyof typeof VARIANT_CLASS;

export function StatusTag({
  variant,
  glyph = true,
  children,
}: {
  variant: StatusVariant;
  glyph?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={VARIANT_CLASS[variant]}>
      {glyph ? (
        <span className="v1-tag-glyph" aria-hidden="true">
          {GLYPH[variant]}
        </span>
      ) : null}
      {children}
    </span>
  );
}
