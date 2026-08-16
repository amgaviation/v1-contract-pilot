"use client";

import { useActionState, useState } from "react";
import type { ReactNode } from "react";
import { LButton, LCard, LSeparator } from "@/components/ledger";
import { cn } from "@/lib/ledger/cn";
import {
  ACCENT_SLOTS,
  APPEARANCE_SLOTS,
  DENSITY_SLOTS,
  type ThemeSlots,
} from "@/lib/theme-slots";
import { saveAppearance, type CustomizationFormState } from "./customization-actions";

const initialState: CustomizationFormState = { error: null };

/**
 * APPEARANCE — the three enumerated theme slots, and a preview of what
 * they do before they are saved.
 *
 * Every value offered here comes from lib/theme-slots.ts's lists; this
 * file invents nothing. The swatches paint each accent's real colour
 * through that slot's own `swatch` token, so a pilot picks a colour by
 * looking at it rather than by reading its name — and because the list is
 * curated to accents that stay readable with white text, there is no
 * choice here that can produce an unreadable badge.
 *
 * accent/density are INSTRUMENT concepts (app/design/tokens.css's
 * --signal/--density scale), not a Ledger one — Ledger's own accent is
 * fixed, one indigo, no per-tenant choice. They stay fully live here
 * because app-shell.tsx still stamps data-accent/data-density for every
 * INSTRUMENT screen that has not migrated yet (see that file's own note:
 * "data-accent and data-density still matter too, but only to whatever
 * INSTRUMENT screens remain"); only `appearance` (day/night) is the
 * mechanism Ledger itself also rides, and this file does not touch how
 * that gets applied — see the LEDGER.md migration brief.
 *
 * RADIO GROUPS: there is no shared Ledger radio-group primitive yet
 * (docs/design/LEDGER.md's migration brief calls this out explicitly), so
 * this file builds a minimal one locally — native `input[type=radio]`
 * inputs, visually hidden, each wrapped in a `<label>` styled as a toggle
 * card/chip (RadioOption below). Native radios grouped by a shared `name`
 * are already an accessible radiogroup with no extra ARIA required; a
 * `role="radiogroup"` + `aria-labelledby` wrapper is added anyway to keep
 * the same grouped-announcement behavior the old Radix RadioGroup gave.
 * The value each group posts still rides a controlled hidden input rather
 * than the radio's own `name`, for the same reason day-type-row.tsx
 * records at length: React 19 resets an uncontrolled form on every action
 * dispatch, including a rejected one, which would silently restore a
 * control to its mount-time value.
 *
 * THE PREVIEW below stamps the same three data attributes the app shell
 * stamps, on a real element, so what a pilot sees is the actual INSTRUMENT
 * token cascade rather than a drawing of it. It is built from plain
 * elements styled with literal `var(--…)` references to app/design/
 * tokens.css (never through @/components/ui or @/components/ds — every
 * Ledger-migrated file must import neither), which is the same "escape
 * hatch" idiom the pre-migration version of this file already used for
 * its own border/radius styling.
 */
export default function AppearancePanel({
  slots,
  canEdit,
}: {
  slots: ThemeSlots;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveAppearance, initialState);

  // All three controls are controlled React state posting through hidden
  // inputs, so React 19's per-dispatch form reset cannot blank them the
  // way it blanks an uncontrolled field — but the action still echoes
  // what was submitted, and this seeds from it, so a remount after a
  // rejected save shows the pilot's pick rather than the stored value.
  const submitted = state.values;
  const [accent, setAccent] = useState(() => submitted?.accent ?? slots.accent);
  const [density, setDensity] = useState(() => submitted?.density ?? slots.density);
  const [appearance, setAppearance] = useState(
    () => submitted?.appearance ?? slots.appearance
  );

  const dirty =
    accent !== slots.accent ||
    density !== slots.density ||
    appearance !== slots.appearance;

  // The preview is driven by the SAME enumerated lists, resolved the same
  // way the shell resolves them — a slot the lists don't know about
  // cannot reach this component, so the fallbacks below are for
  // TypeScript's benefit rather than a real branch.
  const previewAccent =
    ACCENT_SLOTS.find((slot) => slot.value === accent) ?? ACCENT_SLOTS[0];
  const previewDensity =
    DENSITY_SLOTS.find((slot) => slot.value === density) ?? DENSITY_SLOTS[0];
  const previewAppearance =
    APPEARANCE_SLOTS.find((slot) => slot.value === appearance) ?? APPEARANCE_SLOTS[0];

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-h3 font-semibold">Appearance</h3>

      <LCard>
        <form action={formAction}>
          <div className="flex flex-col gap-4">
            <input type="hidden" name="accent" value={accent} />
            <input type="hidden" name="density" value={density} />
            <input type="hidden" name="appearance" value={appearance} />

            <div className="flex flex-col gap-2">
              <div id="accent-label" className="text-body-s font-medium text-ink">
                Accent colour
              </div>
              <p className="text-caption text-ink-3">
                Used for the current section marker, buttons and links on screens
                still on the old design. These are the colours that stay readable
                with white text on them, which is why the list is short rather
                than a colour picker.
              </p>
              <div
                role="radiogroup"
                aria-labelledby="accent-label"
                className="flex flex-wrap gap-2"
              >
                {ACCENT_SLOTS.map((slot) => (
                  <RadioOption
                    key={slot.value}
                    name="accent-choice"
                    value={slot.value}
                    checked={accent === slot.value}
                    disabled={!canEdit}
                    onChange={setAccent}
                  >
                    <span className="flex items-center gap-2">
                      {/* data-accent/data-appearance are stamped for parity
                          with the app shell, not because they do anything:
                          Ledger has no [data-accent] rule (see the note
                          above ACCENT_SLOTS in lib/theme-slots.ts), so
                          every swatch renders the one real --ledger-accent
                          regardless of slot. */}
                      <span
                        aria-hidden="true"
                        data-accent={slot.value}
                        data-appearance={appearance}
                        className="size-4 shrink-0 rounded-control"
                        style={{ background: slot.swatch, border: "1px solid var(--ledger-hair)" }}
                      />
                      {slot.label}
                    </span>
                  </RadioOption>
                ))}
              </div>
            </div>

            <LSeparator />

            <div className="flex flex-wrap gap-6">
              <div className="flex flex-col gap-2">
                <div id="density-label" className="text-body-s font-medium text-ink">
                  Density
                </div>
                <div
                  role="radiogroup"
                  aria-labelledby="density-label"
                  className="flex flex-col gap-2"
                >
                  {DENSITY_SLOTS.map((slot) => (
                    <RadioOption
                      key={slot.value}
                      name="density-choice"
                      value={slot.value}
                      checked={density === slot.value}
                      disabled={!canEdit}
                      onChange={setDensity}
                    >
                      <span className="flex items-baseline gap-2">
                        {slot.label}
                        <span className="text-caption text-ink-3">{slot.hint}</span>
                      </span>
                    </RadioOption>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div id="mode-label" className="text-body-s font-medium text-ink">
                  Light or dark
                </div>
                <div
                  role="radiogroup"
                  aria-labelledby="mode-label"
                  className="flex flex-col gap-2"
                >
                  {APPEARANCE_SLOTS.map((slot) => (
                    <RadioOption
                      key={slot.value}
                      name="appearance-choice"
                      value={slot.value}
                      checked={appearance === slot.value}
                      disabled={!canEdit}
                      onChange={setAppearance}
                    >
                      {slot.label}
                    </RadioOption>
                  ))}
                </div>
                <p className="text-caption text-ink-3">
                  The section rail stays dark in both. In dark mode it sits a step
                  above the page so the two never blur together.
                </p>
              </div>
            </div>

            <LSeparator />

            {/* THE PREVIEW. The same three data attributes the app shell
                stamps, on a real element — but under Ledger only
                data-appearance has any CSS behind it (app/design/ledger.css
                has no [data-accent]/[data-density] rule; see the note above
                ACCENT_SLOTS). data-accent/data-density stay stamped for
                parity with the shell and because they're harmless, not
                because anything here reacts to them: this preview now only
                demonstrates day/night. Every value comes from real Ledger
                tokens (components/ledger's own recipe), not a drawing of
                them. */}
            <div className="flex flex-col gap-2">
              <div className="text-body-s font-medium text-ink">Preview</div>
              <div
                data-appearance={previewAppearance.value}
                data-accent={previewAccent.value}
                data-density={previewDensity.density}
                className="rounded-card p-4"
                style={{ background: "var(--ledger-canvas)", border: "1px solid var(--ledger-hair)" }}
              >
                <div
                  className="flex flex-col gap-3 rounded-card p-4"
                  style={{ background: "var(--ledger-card)", border: "1px solid var(--ledger-hair)" }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span style={{ color: "var(--ledger-ink)" }} className="font-bold">
                      Trip to KTEB
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={{ background: "var(--ledger-good-soft)", color: "var(--ledger-good)" }}
                    >
                      Paid
                    </span>
                  </div>
                  <p style={{ color: "var(--ledger-ink-2)" }} className="text-sm">
                    Two flight days, one travel day. This card and this badge use
                    Ledger's real colours in day or night, whichever you just picked.
                  </p>
                  <div className="flex gap-2">
                    <span
                      className="rounded-control px-3 py-1.5 text-sm font-medium"
                      style={{ background: "var(--ledger-accent)", color: "var(--ledger-accent-ink)" }}
                    >
                      Primary
                    </span>
                    <span
                      className="rounded-control px-3 py-1.5 text-sm font-medium"
                      style={{ background: "var(--ledger-sunk)", color: "var(--ledger-ink-2)" }}
                    >
                      Secondary
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div role="alert" aria-live="polite">
              {state.error ? (
                <p className="text-caption font-medium text-crit">{state.error}</p>
              ) : state.saved && !dirty ? (
                <p className="text-caption font-medium text-good">Saved.</p>
              ) : dirty ? (
                <p className="text-caption font-medium text-warn">
                  Not saved yet. The preview above is showing your choice. Save to
                  apply it to the whole account.
                </p>
              ) : null}
            </div>

            {canEdit ? (
              <div>
                <LButton type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save appearance"}
                </LButton>
              </div>
            ) : (
              <p className="text-caption text-ink-3">
                Only the account owner can change how this account looks.
              </p>
            )}
          </div>
        </form>
      </LCard>
    </div>
  );
}

/**
 * The local radio-group option — see the file header. `sr-only` on the
 * actual input keeps it in the accessibility tree (focusable, announced,
 * arrow-key-navigable as part of the native radio group) while the label
 * itself carries the visible checked state.
 */
function RadioOption({
  name,
  value,
  checked,
  disabled,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-control border px-3 py-2 text-body-s transition-colors",
        checked
          ? "border-accent bg-accent-soft text-ink"
          : "border-hair-strong bg-card text-ink-2 hover:bg-sunk",
        disabled && "pointer-events-none opacity-50"
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="sr-only"
      />
      {children}
    </label>
  );
}
