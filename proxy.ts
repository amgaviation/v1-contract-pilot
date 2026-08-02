import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Named `proxy.ts` / `proxy()`, not `middleware.ts` / `middleware()` — the
// latter is deprecated as of Next.js 16. Mirrors amgaviation/amg1's
// proxy.ts convention.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
