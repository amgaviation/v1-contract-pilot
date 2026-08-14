import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Refreshes the Supabase auth session on every matched request. Required
 * so Server Components always see a valid session — see proxy.ts (repo
 * root) for the route matcher.
 */
export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // No Supabase project exists yet in Phase 0, so this is expected in
    // development and preview right now. It must NOT stay silent once an
    // auth gate exists: this is exactly the code path a real deployment's
    // auth check hangs off (see the comment at the bottom of this
    // function), so a misconfigured env var here — a renamed key, a
    // Preview-vs-Production scoping mistake — would otherwise make every
    // route render unauthenticated with no error and no log line. Fail
    // loudly everywhere except local development, where an unconfigured
    // Supabase project is the normal starting state.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "NEXT_SUPABASE_URL / NEXT_SUPABASE_PUBLISHABLE_KEY are unset in production — refusing to serve requests without a working auth gate."
      );
    }
    return response;
  }

  return refreshSession(request, response, supabaseUrl, supabaseAnonKey);
}

async function refreshSession(
  request: NextRequest,
  initialResponse: NextResponse,
  supabaseUrl: string,
  supabaseAnonKey: string
) {
  let response = initialResponse;

  const supabase = createServerClient<Database, "pilot">(
    supabaseUrl,
    supabaseAnonKey,
    {
      db: { schema: "pilot" },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Touch the session so an expired token gets refreshed before it
  // reaches a Server Component. Auth gating on specific routes is a
  // Phase 1 follow-up once pilot.accounts / pilot.account_members exist —
  // when it lands, the redirect-to-login belongs right after this call,
  // which is exactly why the missing-env case above must fail loudly
  // rather than silently pass every request through ungated.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The auth gate that comment earmarked now lives here. A signed-out
  // request to any gated path is redirected to /login (carrying the
  // requested path as ?next so login can bounce back). /login and
  // /welcome are the signed-out surface itself and pass through —
  // /welcome's own page handles the no-session case, so there is no
  // loop. app/(app)/layout.tsx re-checks server-side, so this is defense
  // in depth, not the sole gate.
  //
  // WHY AN UNMATCHED PATH ALSO REDIRECTS TO /login RATHER THAN REACHING
  // app/not-found.tsx: this check runs before Next's router has tried to
  // match anything, so there is no way from here to ask "does a page
  // exist at this path" — only "is this path on the public allow-list
  // below". Everything else, real gated feature or pure typo alike, gets
  // the identical /login redirect. That is a deliberate choice, not a
  // gap: a uniform response for anything not on this list means a
  // stranger poking at paths can never learn which ones are real
  // (gated) features and which are nothing at all — a plain 404 would
  // hand them that distinction for free. The cost lands on exactly one
  // visitor class: a pilot's CLIENT (no account, never will have one)
  // whose invoice or packet link got mangled badly enough to lose the
  // whole "/invoice/" or "/packet/" stem, not just part of the token.
  // Ordinary truncation — an email client cutting a long URL from the
  // end — never does that: /invoice/<anything> and /packet/<anything>
  // are already below, unconditionally, so a partially-cut link still
  // reaches its own route and its own client-tailored not-found copy
  // (app/invoice/[token]/not-found.tsx, app/packet/[token]/not-found.tsx),
  // never this redirect. The bare `normalizedPath === "/invoice"` /
  // `"/packet"` lines below exist for the narrower remainder — a link
  // cut at exactly the stem — so at least that much of a destroyed link
  // still reads as "not found" instead of "sign in to a product you've
  // never heard of". Both are exact matches, not prefixes: neither has a
  // page behind it (only the [token] child route does), so allowing them
  // through exposes nothing — Next's router still renders the ordinary
  // root 404 for both, same as any other path that resolves to no page.
  const path = request.nextUrl.pathname;
  // Strip a single trailing slash before matching the allow-list below, so
  // "/pricing/" still matches "/pricing" instead of falling through to the
  // login redirect. "/" has no trailing slash to strip.
  const normalizedPath = path.length > 1 ? path.replace(/\/$/, "") : path;
  const isAuthSurface =
    // The signed-out marketing surface: app/(marketing)/{page,pricing,
    // terms,privacy}.tsx. All four are exact matches, not prefixes — none
    // of the four has a planned subroute, and a stray prefix match here
    // would silently wave through anything a future route nests under one
    // of them. "/" itself moved out of the (app) route group precisely so
    // it could be public; app/(marketing)/page.tsx does the further
    // signed-in-vs-signed-out branch once it's actually rendering (the
    // Overview dashboard now lives at /overview, gated the normal way
    // below, not on this list).
    normalizedPath === "/" ||
    normalizedPath === "/pricing" ||
    normalizedPath === "/terms" ||
    normalizedPath === "/privacy" ||
    normalizedPath === "/login" ||
    normalizedPath === "/signup" ||
    path.startsWith("/welcome") ||
    // Password recovery is by definition a signed-out surface. /auth/confirm
    // must pass through because it is what MINTS the session — gating it on
    // one would make every emailed link bounce to /login and lose its token.
    // /reset-password does its own session check (see its page).
    normalizedPath === "/forgot-password" ||
    normalizedPath === "/reset-password" ||
    // app/robots.ts and app/sitemap.ts: crawler requests carry no session,
    // so without this an anonymous /robots.txt or /sitemap.xml request gets
    // 307'd to /login instead of served. The top-level proxy.ts matcher
    // already lets both through (neither is excluded there).
    normalizedPath === "/robots.txt" ||
    normalizedPath === "/sitemap.xml" ||
    // app/manifest.ts, served at /manifest.webmanifest. THE SAME FAILURE
    // MODE AS THE TWO ABOVE, and the reason it survived a round of review
    // is that it bites a SIGNED-IN pilot too: per the W3C manifest spec a
    // browser fetches the manifest WITHOUT credentials unless the <link>
    // carries crossorigin="use-credentials", and the tag Next injects is
    // bare. The fetch therefore arrives here cookie-less no matter who is
    // driving the browser, gets 307'd to /login, and the browser tries to
    // parse a login page as JSON. Measured before this line existed:
    // `curl /manifest.webmanifest` answered
    // `307 -> /login?next=%2Fmanifest.webmanifest` and resolved to
    // text/html. The consequence is not cosmetic — with no parseable
    // manifest Android's install criteria never pass, and on iOS (which has
    // no apple-mobile-web-app-capable fallback in app/layout.tsx, only the
    // touch icon) Add to Home Screen yields a Safari bookmark rather than
    // the standalone app. docs/WAVE-PARITY.md 7.5's "installable" claim
    // rests entirely on this line.
    //
    // Serving it discloses nothing: app/manifest.ts is static brand strings
    // and icon paths, byte-identical for every visitor, naming files that
    // are already public. Kept on the ALLOW-LIST rather than excluded in
    // proxy.ts's matcher (where favicon.ico sits) so the reasoning lives
    // beside /robots.txt and /sitemap.xml, which this case exactly matches.
    normalizedPath === "/manifest.webmanifest" ||
    path.startsWith("/auth/") ||
    // The Stripe webhook is machine-to-machine and carries no session. It
    // authenticates by signature (see the route), which is stronger than a
    // cookie here — redirecting it to /login would silently break
    // provisioning and Stripe would just see 307s.
    path.startsWith("/api/stripe/") ||
    // The client-facing invoice share link (app/invoice/[token]/page.tsx,
    // deliberately OUTSIDE the (app) route group) is this product's one
    // page meant to be opened by someone with NO account at all — a
    // pilot's client. It authenticates by an unguessable 256-bit token in
    // the URL itself (see supabase/migrations/20260809060000_
    // invoice_public_share.sql), not by a session, so redirecting a
    // signed-out visitor to /login here would break the entire feature:
    // the client has no login to redirect to.
    path.startsWith("/invoice/") ||
    // See the comment above `const path` on this one: a link truncated
    // down to the bare stem, token and all, has nowhere else to match.
    normalizedPath === "/invoice" ||
    // The client-facing credential packet (app/packet/[token]/page.tsx),
    // same shape and same reasoning as /invoice/ above: authenticated by
    // an unguessable 256-bit token in the URL, opened by someone who has
    // no account here and never will. Without this line a pilot's client
    // clicks the link they were sent and lands on a login form — the
    // whole feature, silently dead. Caught before shipping only because
    // /ocr had exactly this bug an hour earlier.
    path.startsWith("/packet/") ||
    normalizedPath === "/packet" ||
    // THE LAYOUT HARNESS — app/(dev)/layout-harness, the fixture render of
    // the authenticated shell that scripts/layout-verify.mjs measures. It
    // needs no session by construction (that is the entire point: the
    // shell could not be tested while it was reachable only from behind
    // one), so it has to be on this allow-list or the verify script
    // measures a redirect to /login at every viewport and passes on
    // nothing.
    //
    // Gated on NODE_ENV twice over, deliberately: here, so off development
    // the path is not even an allow-listed surface, and again inside the
    // page itself, which calls notFound(). The page's own guard is the one
    // that matters — this line only lets that guard be REACHED in
    // development — but a public route rendering product chrome should not
    // be one edit away from existing in production.
    (process.env.NODE_ENV === "development" &&
      (normalizedPath === "/layout-harness" ||
        // The seam harness — app/(dev)/seam-harness. Renders every shimmed
        // component in the prop shapes the authenticated screens really use,
        // which is the closest the migration can get to exercising those
        // screens without a seeded tenant. Same two guards as the others.
        normalizedPath === "/seam-harness" ||
        // The INSTRUMENT specimen sheet — app/(dev)/design-harness. Same
        // reasoning and the same two guards as the layout harness above: the
        // page itself calls notFound() off development, and this line only
        // lets that guard be reached.
        normalizedPath === "/design-harness"));
  if (!user && !isAuthSurface) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
