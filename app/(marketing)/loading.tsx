import { LSpinner } from "@/components/ledger";

/**
 * Only app/(marketing)/page.tsx actually awaits anything (the signed-in
 * redirect check) — /pricing, /terms and /privacy are static and resolve
 * before this could ever paint. It lives at the group root rather than
 * nested under page.tsx alone because a route segment's loading.tsx has no
 * narrower target than "this page slot," and there is only the one page
 * here that needs it.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center gap-2 px-4 py-24">
      {/* LSpinner carries its own role="status" + aria-label — the
          accessible announcement. The text beside it is aria-hidden, the
          sighted half of the same statement. */}
      <LSpinner />
      <span aria-hidden className="text-body-s text-ink-2">
        Loading…
      </span>
    </div>
  );
}
