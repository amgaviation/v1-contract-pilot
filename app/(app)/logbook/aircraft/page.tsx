import { redirect } from "next/navigation";

/**
 * Redirect stub. The fleet screen was promoted to its own top-level
 * section at /aircraft (RECORDS group) — see app/(app)/aircraft/page.tsx,
 * which carries every read, write and comment that used to live here.
 *
 * This file exists only so a bookmark, a link typed from memory, or a
 * stale reference somewhere outside this repo keeps working rather than
 * 404ing. app/(app)/layout.tsx already gates every route under (app)
 * behind requireAccount(), so a signed-out visitor is bounced to /login
 * before ever reaching this redirect — nothing here needs to repeat that
 * check.
 */
export default function AircraftRedirect() {
  redirect("/aircraft");
}
