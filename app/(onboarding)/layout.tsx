import { BRAND } from "@/lib/brand";

/**
 * The post-checkout onboarding surface. Its OWN route group, deliberately
 * outside (app): the (app) layout redirects a provisioned-but-not-onboarded
 * account to /onboarding, so the wizard must not itself live under that gate
 * or the redirect would loop. No dashboard rail — the pilot has nothing to
 * navigate to yet. The page does its own session check (requireAccount with
 * allowUnonboarded).
 *
 * LEDGER'S SOFTER MARKETING VARIANT, same posture as ../(auth)/layout.tsx
 * and the two client-facing portals — `bg-canvas font-ledger text-body
 * text-ink` — but a wider measure (44rem, unchanged) than the auth screens'
 * narrow column: the wizard's three-step form needs the room a login card
 * does not.
 *
 * The slim header is the one piece of chrome, so this screen is
 * recognisably the same product the pilot just paid for rather than a bare
 * form on a gray field. It carries the mark and nothing clickable: there is
 * deliberately nowhere to go from here except through the wizard or past it
 * ("Skip for now").
 */
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // .v1-nozoom-fields: the wizard's eighteen fields all render Ledger's
    // fixed 15px control text — see components/ledger/forms.tsx's own
    // header on why the shell still carries this class regardless. Pure
    // touch-device font-sizing, not a value tokens:verify's rules police.
    <div className="v1-nozoom-fields min-h-dvh bg-canvas font-ledger text-body text-ink">
      <div className="border-b border-hair bg-card">
        <div className="mx-auto w-full max-w-[44rem] px-4">
          <div className="flex items-center gap-3 py-3">
            <img src="/brand/navy.svg" alt="" height={20} width={34} />
            <span className="text-caption text-ink-3">{BRAND.descriptor} · Account setup</span>
          </div>
        </div>
      </div>

      <div className="px-4 pb-8">
        <div className="mx-auto w-full max-w-[44rem] py-6">{children}</div>
      </div>
    </div>
  );
}
