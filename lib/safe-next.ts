/**
 * The one place a `next=` redirect target is decided.
 *
 * WHY THIS FILE EXISTS. The rule lived in three hand-written copies — the
 * login action, the login page, and the auth-confirm route — and all three
 * were the same test:
 *
 *     next.startsWith("/") && !next.startsWith("//")
 *
 * which is wrong, and wrong in a way that reads as careful. It rejects the
 * forward-slash form of a protocol-relative URL and nothing else. A single
 * BACKSLASH walks straight through it: `/\evil.com` starts with "/" and does
 * not start with "//", so the guard passes it — and then the URL parser, per
 * the WHATWG spec, normalises the backslash to a forward slash for special
 * schemes, so the browser resolves it as an authority rather than a path and
 * navigates off-origin.
 *
 * The attack that makes it worth caring about on THIS product: a stranger
 * sends a pilot `https://<host>/login?next=/%5Cevil.com`. The link is to the
 * real product, on the real domain, and the login page it lands on is the
 * genuine one. The pilot signs in — correctly — and is then redirected to an
 * attacker-controlled host that shows a convincing "session expired, sign in
 * again" form. The credentials it harvests are for an account holding this
 * pilot's client list, their revenue, and their scanned receipts.
 *
 * THE FIX IS TO STOP HAND-PARSING. Enumerating bad prefixes is a losing game:
 * the list of ways to express an off-origin target is longer than anyone's
 * intuition, and the string test and the browser's parser are two different
 * implementations that only have to disagree once. So this resolves the
 * candidate with the same parser the browser uses and keeps it only if the
 * result stayed on the origin it was resolved against. A backslash, an
 * absolute URL, a scheme, a userinfo trick, and every future spelling of the
 * same idea all fail that check without anyone having to have predicted them.
 *
 * Three independent security reviewers found this in the same session, from
 * three different starting points. That is a good sign the shape of the bug is
 * obvious in hindsight and was not obvious in the writing.
 */

/**
 * A placeholder origin to resolve against. Nothing is ever fetched from it;
 * it exists so relative and absolute candidates can be compared on equal
 * terms. `.invalid` is reserved by RFC 2606 and can never resolve, so a value
 * that somehow escaped this function could not reach a real host.
 */
const RESOLUTION_ORIGIN = "https://placeholder.invalid";

/**
 * Reduce a caller-supplied `next` to an app-internal path, or to "/".
 *
 * Returns the path with its query and fragment intact, because a redirect back
 * to `/invoices?status=overdue` after signing in is the point of the feature.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/";

  // A candidate must be relative to begin with. This is not the security
  // check — the origin comparison below is — but it rejects the obvious cases
  // before doing any parsing, and it keeps an absolute URL that happens to
  // point at the placeholder from being honoured.
  if (!next.startsWith("/")) return "/";

  let resolved: URL;
  try {
    resolved = new URL(next, RESOLUTION_ORIGIN);
  } catch {
    // An unparseable candidate is not a path we should follow.
    return "/";
  }

  // THE ACTUAL CHECK. If resolving moved us off the origin we resolved
  // against, the candidate was never a path — whatever it looked like.
  if (resolved.origin !== RESOLUTION_ORIGIN) return "/";

  // Re-serialise from the parsed URL rather than returning the caller's
  // string, so what gets redirected to is exactly what was validated. Handing
  // back the raw input would leave room for the redirect and the check to read
  // it differently, which is the whole class of bug this file closes.
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
