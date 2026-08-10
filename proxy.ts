import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Named `proxy.ts` / `proxy()`, not `middleware.ts` / `middleware()` — the
// latter is deprecated as of Next.js 16. Mirrors amgaviation/amg1's
// proxy.ts convention.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// `ocr/` is excluded alongside Next's own static output, and it has to be.
// Those files are the receipt scanner's engine — a WebAssembly build of
// Tesseract and an English language model, copied verbatim out of
// node_modules by scripts/sync-ocr-assets.mjs. They carry no tenant data;
// they are the same public bytes that sit on npm.
//
// Found on the deployed preview, not locally: without this, a request for
// /ocr/worker.min.js answered `307 -> /login?next=/ocr/worker.min.js`. A
// signed-in pilot would have got through on their session cookie, so this
// would not have failed outright — it would have run a Supabase session
// refresh in front of every asset, including a 3.9 MB core, and left a
// redirect-to-HTML as a live failure mode inside a Web Worker's
// importScripts(), where the resulting error is close to undiagnosable.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|ocr/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
