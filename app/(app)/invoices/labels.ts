/**
 * Shared label maps for enum-ish values that reach the pilot's screen.
 *
 * Lives here, not in actions.ts, because actions.ts is a "use server"
 * module — every export from it is treated as a Server Action, which must
 * be async, so a plain synchronous helper like categoryLabel can't be
 * exported from there directly (Next.js's build rejects it: "Server
 * Actions must be async functions"). This file has no directive, so both
 * the server actions and client components (e.g. lines-editor.tsx) can
 * import the SAME map instead of a client-side copy drifting from it.
 */

/** expenses.category -> the label a pilot/client reads instead of the raw enum value. */
export function categoryLabel(category: string): string {
  const labels: Record<string, string> = {
    airline: "Airline",
    hotel: "Hotel",
    rental_car: "Rental car",
    rideshare: "Rideshare",
    fuel: "Fuel",
    meals: "Meals",
    parking: "Parking",
    other: "Expense",
  };
  return labels[category] ?? "Expense";
}
