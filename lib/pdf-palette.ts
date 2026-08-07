import { slate, blue } from "@radix-ui/colors";

/**
 * The invoice PDF's colour source.
 *
 * WHY THIS FILE EXISTS: an invoice is the most brand-visible thing this
 * product emits — it goes to the pilot's client on their letterhead, not
 * ours. @react-pdf/renderer has its own styling engine and cannot reach
 * CSS, so it cannot read Radix Themes' custom properties the way every
 * screen does. Without a deliberate bridge, the PDF ends up with literal
 * colours baked into it, and the one artifact a customer actually keeps
 * drifts away from the product the moment anything is restyled.
 *
 * @radix-ui/colors is the same scale Radix Themes is built on, published
 * as plain JS. So these are not "matching" values re-typed by hand — they
 * are the identical values, from the identical source, reached through the
 * one import path react-pdf can follow.
 *
 * Two things a future reader will want to know:
 *
 *  - The scales here must stay in step with the <Theme> props in
 *    app/layout.tsx (grayColor="slate", accentColor="blue"). Change those
 *    and change these; they are the only two places the palette is named.
 *  - Step numbers are not arbitrary. Radix's scale is semantic: 1 is the
 *    app background, 6 a subtle border, 8 a stronger border, 11 low-
 *    contrast text, 12 high-contrast text. Picking by step keeps the
 *    contrast relationships intact even if the hue changes.
 */
export const PDF_PALETTE = {
  /** Body text and the hard rules that separate sections. Step 12. */
  ink: slate.slate12,
  /** Labels, secondary figures. Step 11 — the readable low-contrast step. */
  muted: slate.slate11,
  /** Row dividers. Step 8, so totals still dominate the table. */
  hairline: slate.slate8,
  /** The page. Deliberately pure white rather than slate1: this is print,
   *  and a tinted "paper" reproduces badly on a real printer. */
  paper: "#ffffff",
  /** Reserved for anything the invoice needs to mark as actionable — a
   *  payment link, an overdue notice. Step 11 is the text-safe accent
   *  step; blue9 is a fill colour and fails as small text. */
  accent: blue.blue11,
} as const;
