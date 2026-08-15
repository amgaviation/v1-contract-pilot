import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * LEDGER's class combiner: clsx for conditionals, tailwind-merge so a
 * caller's `className` can override a component's own utilities without a
 * specificity fight (`cn("px-4", className)` with className="px-6" yields
 * px-6, not both). The old system's cx() (lib/ds/props.ts) stays for
 * INSTRUMENT screens; this one is for Ledger components only — the two
 * must not cross-pollinate, because tailwind-merge would mangle i-* names
 * it does not understand into keep/drop decisions it has no basis for.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
