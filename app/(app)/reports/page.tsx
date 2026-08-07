import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/supabase/account";

// The only report today is the year-end packet. Redirecting here (rather
// than making /reports/year-end itself the nav target) leaves room for a
// future reports index without moving the nav entry or breaking this URL.
export default async function ReportsIndexPage() {
  await requireAccount("/reports");
  redirect("/reports/year-end");
}
