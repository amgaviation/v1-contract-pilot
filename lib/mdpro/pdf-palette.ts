import colors from "@/lib/mdpro/theme/base/colors";

/**
 * The invoice PDF's colour source.
 *
 * WHY THIS FILE EXISTS: an invoice is the most brand-visible thing this
 * product emits — it goes to the pilot's client on their letterhead, not
 * ours. @react-pdf/renderer has its own styling engine and cannot reach
 * the MUI theme, CSS custom properties, or anything else the screens use,
 * so without a deliberate bridge the PDF ends up with literal colours
 * baked into it. docs/PLAN.md decision #20 is that a future design
 * overhaul must stay a change to the token layer and nothing else, and a
 * PDF full of "black" and "grey" quietly breaks that promise in the one
 * artifact a customer actually keeps.
 *
 * Living inside lib/mdpro/ means these values are re-derived from the
 * same theme the screens render from: restyle the theme and the invoice
 * follows. tokens:verify does not currently flag CSS *named* colours
 * (only hex/rgb/hsl), so nothing mechanical would have caught the
 * literals — this is the structural fix rather than a lint-passing one.
 */
const theme = (colors as {
  dark: { main: string };
  text: { main: string };
  grey: Record<number, string>;
  white: { main: string };
}) ?? {};

export const PDF_PALETTE = {
  /** Body text and the hard rules that separate sections. */
  ink: theme.dark?.main ?? "#171717",
  /** Labels, secondary figures, hairlines. */
  muted: theme.text?.main ?? "#737373",
  /** Row dividers — lighter than `muted` so totals still dominate. */
  hairline: theme.grey?.[400] ?? "#a3a3a3",
  paper: theme.white?.main ?? "#ffffff",
} as const;
