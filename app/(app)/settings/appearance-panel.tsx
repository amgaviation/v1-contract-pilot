"use client";

import { useActionState, useState } from "react";
import type { ReactNode } from "react";
import { LButton, LCard } from "@/components/ledger";
import { cn } from "@/lib/ledger/cn";
import { APPEARANCE_SLOTS, type ThemeSlots } from "@/lib/theme-slots";
import { saveAppearance, type CustomizationFormState } from "./customization-actions";

const initialState: CustomizationFormState = { error: null };

/**
 * APPEARANCE — day or night, and a live preview of the choice.
 *
 * ONLY day/night is offered here. This panel used to carry an accent-colour
 * picker and a density picker too, but Ledger has exactly one accent (a
 * fixed indigo) and one type scale: app/design/ledger.css has no
 * `[data-accent]` or `[data-density]` rule at all. Those two pickers drove
 * exactly those attributes, so the moment INSTRUMENT was deleted (phase 6)
 * they became inert — a density choice that changed nothing, and an accent
 * row where every "colour" swatch rendered the same indigo. A control that
 * cannot do what it says is worse than no control, so both are gone from the
 * UI. Their STORED values are deliberately preserved: posted back unchanged
 * as hidden inputs below, so saveAppearance's shape and the saved row are
 * untouched and nothing is lost if a future design system ever gives accent
 * or density meaning again.
 *
 * RADIO GROUP: native `input[type=radio]`s grouped by a shared `name`, each
 * visually hidden inside a `<label>` styled as a toggle chip (RadioOption
 * below). Native radios so grouped are already an accessible,
 * arrow-navigable radiogroup with no extra ARIA; the `role="radiogroup"` +
 * `aria-labelledby` wrapper is added only to keep the grouped-announcement
 * behaviour the old Radix RadioGroup gave. The value posts through a
 * controlled hidden input rather than the radio's own `name`, because React
 * 19 resets an uncontrolled form on every action dispatch — including a
 * rejected one — which would silently restore a control to its mount-time
 * value (day-type-row.tsx records the same reasoning at length).
 *
 * THE PREVIEW stamps `data-appearance` on a real element and paints with
 * Ledger's real tokens, so a pilot sees the actual day/night cascade rather
 * than a drawing of it.
 */
export default function AppearancePanel({
  slots,
  canEdit,
}: {
  slots: ThemeSlots;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveAppearance, initialState);

  // Controlled through a hidden input, so React 19's per-dispatch form reset
  // cannot blank it — and the action echoes what was submitted, so a remount
  // after a rejected save shows the pilot's pick rather than the stored value.
  const submitted = state.values;
  const [appearance, setAppearance] = useState(
    () => submitted?.appearance ?? slots.appearance
  );

  const dirty = appearance !== slots.appearance;

  // Resolved the same way the shell resolves it — a slot the list doesn't
  // know about cannot reach this component, so the fallback is for
  // TypeScript's benefit rather than a real branch.
  const previewAppearance =
    APPEARANCE_SLOTS.find((slot) => slot.value === appearance) ?? APPEARANCE_SLOTS[0];

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-h3 font-semibold">Appearance</h3>

      <LCard>
        <form action={formAction}>
          <div className="flex flex-col gap-4">
            {/* accent and density are retired from the UI (see the header)
                but preserved in storage: posted back unchanged so the saved
                row and saveAppearance's shape are unaffected. */}
            <input type="hidden" name="accent" value={slots.accent} />
            <input type="hidden" name="density" value={slots.density} />
            <input type="hidden" name="appearance" value={appearance} />

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

            {/* THE PREVIEW. data-appearance on a real element — the one slot
                with CSS behind it under Ledger — painted with real Ledger
                tokens (components/ledger's own recipe), not a drawing of
                them. */}
            <div className="flex flex-col gap-2">
              <div className="text-body-s font-medium text-ink">Preview</div>
              <div
                data-appearance={previewAppearance.value}
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
                    Two flight days, one travel day. Real colours, in whichever mode you just picked.
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
        // Keyboard focus indicator for the sr-only radio inside this label —
        // the input itself can't carry a visible focus-visible ring (it's
        // hidden), so the house ring is applied to the label via the
        // parent-side `has-[:focus-visible]:` variant instead. Same three
        // utilities every other Ledger interactive primitive uses (see
        // LButton's focus-visible ring above).
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
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
