/**
 * Address shape checking, kept OUT of lib/email/send.ts on purpose.
 *
 * send.ts carries `import "server-only"`, which is correct — it holds the API
 * credential and must never be reachable from a Client Component. But that
 * import also makes the module unloadable in a plain Node test process, and
 * this function is exactly the kind of thing that should be pinned by tests:
 * pure, total, and the guard standing between a typo and a bill that silently
 * goes nowhere.
 *
 * So it lives here with no imports at all, and send.ts consumes it.
 */

/**
 * Deliberately permissive — a typo guard, not an RFC 5322 implementation. A
 * real address wrongly rejected here is a worse bug than the malformed one it
 * would have caught, because the pilot cannot invoice their client at all and
 * has no way to override it.
 */
export function looksLikeEmail(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 254) return false;
  if (/\s/.test(trimmed)) return false;
  const at = trimmed.indexOf("@");
  if (at < 1 || at !== trimmed.lastIndexOf("@")) return false;
  const domain = trimmed.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}
