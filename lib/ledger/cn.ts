import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * LEDGER's class combiner: clsx for conditionals, tailwind-merge so a
 * caller's `className` can override a component's own utilities without a
 * specificity fight (`cn("px-4", className)` with className="px-6" yields
 * px-6, not both). The old system's cx() (lib/ds/props.ts) stays for
 * INSTRUMENT screens; this one is for Ledger components only — the two
 * must not cross-pollinate, because tailwind-merge would mangle i-* names
 * it does not understand into keep/drop decisions it has no basis for.
 *
 * WHY extendTailwindMerge AND NOT bare twMerge — this is load-bearing, not
 * a nicety. Ledger renames three of Tailwind's scales in app/design/
 * ledger.css's @theme block: the font-size scale (text-caption, text-body,
 * text-body-s, text-lead, text-h1/h2/h3, text-figure), the border-radius
 * scale (rounded-control, rounded-card) and the box-shadow scale
 * (shadow-card, shadow-raised). tailwind-merge ships knowing only stock
 * Tailwind, so it cannot tell that `text-body` is a FONT SIZE — its
 * text-color validator accepts any unknown word, so `text-body` and
 * `text-accent-ink` both land in the SINGLE text-* conflict group and it
 * keeps only the last one written. In cva the size variant is composed
 * AFTER the color, so `text-body-s` always won and `text-accent-ink` was
 * silently dropped from every filled button — leaving primary buttons with
 * no colour class at all, inheriting near-black `text-ink` onto indigo
 * (~2.4:1, unreadable). Registering the renamed values in their real groups
 * below is what lets a colour and a size coexist on one element. The color
 * scales need no registration: the text-color / bg-color / border-color
 * validators already accept arbitrary token names, and those never shared a
 * prefix-group with a non-colour scale the way text-{size} did.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["caption", "body-s", "body", "lead", "h1", "h2", "h3", "figure"] },
      ],
      rounded: [{ rounded: ["control", "card"] }],
      shadow: [{ shadow: ["card", "raised"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
