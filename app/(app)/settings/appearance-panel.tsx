"use client";

import { useActionState, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Heading,
  RadioGroup,
  Separator,
  Text,
  Theme,
} from "@/components/ui";
import { BRAND } from "@/lib/brand";
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
 * curated to accents Radix pairs with WHITE contrast ink, there is no
 * choice here that can produce an unreadable badge.
 *
 * The controls are a RadioGroup rather than a row of buttons: arrow-key
 * roving focus, a single tab stop per group, and the selected state
 * announced, all for free. The value each group posts rides a controlled
 * hidden input rather than the control's own `name`, for the reason
 * day-type-row.tsx records at length — React 19 resets an uncontrolled
 * form on every action dispatch, including a rejected one, which would
 * silently restore a control to its mount-time value.
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
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="1">
        <Heading as="h3" size="4">
          Appearance
        </Heading>
        <Text size="2" color="gray">
          How {BRAND.name} looks for this account, on every device you sign in from.
          It changes nothing about your records, your invoices or what your clients
          see — an invoice PDF and a shared invoice link look the same to them
          whatever you pick here.
        </Text>
      </Flex>

      <Card>
        <form action={formAction}>
          <Flex direction="column" gap="4" p="1">
            <input type="hidden" name="accent" value={accent} />
            <input type="hidden" name="density" value={density} />
            <input type="hidden" name="appearance" value={appearance} />

            <Flex direction="column" gap="2">
              <Text as="div" size="2" weight="medium" id="accent-label">
                Accent colour
              </Text>
              <Text size="1" color="gray">
                Used for the current section marker, buttons and links. These are the
                colours that stay readable with white text on them — that is why the
                list is short rather than a colour picker.
              </Text>
              <RadioGroup.Root
                value={accent}
                onValueChange={setAccent}
                disabled={!canEdit}
                aria-labelledby="accent-label"
              >
                <Flex gap="4" wrap="wrap">
                  {ACCENT_SLOTS.map((slot) => (
                    <Text as="label" size="2" key={slot.value}>
                      <Flex gap="2" align="center">
                        <RadioGroup.Item value={slot.value} />
                        <Box
                          aria-hidden="true"
                          width="16px"
                          height="16px"
                          style={{
                            background: slot.swatch,
                            borderRadius: "var(--radius-1)",
                            border: "1px solid var(--gray-a5)",
                          }}
                        />
                        {slot.label}
                      </Flex>
                    </Text>
                  ))}
                </Flex>
              </RadioGroup.Root>
            </Flex>

            <Separator size="4" />

            <Flex gap="6" wrap="wrap">
              <Flex direction="column" gap="2">
                <Text as="div" size="2" weight="medium" id="density-label">
                  Density
                </Text>
                <RadioGroup.Root
                  value={density}
                  onValueChange={setDensity}
                  disabled={!canEdit}
                  aria-labelledby="density-label"
                >
                  {DENSITY_SLOTS.map((slot) => (
                    <Text as="label" size="2" key={slot.value}>
                      <Flex gap="2" align="center">
                        <RadioGroup.Item value={slot.value} />
                        {slot.label}
                        <Text size="1" color="gray">
                          {slot.hint}
                        </Text>
                      </Flex>
                    </Text>
                  ))}
                </RadioGroup.Root>
              </Flex>

              <Flex direction="column" gap="2">
                <Text as="div" size="2" weight="medium" id="mode-label">
                  Light or dark
                </Text>
                <RadioGroup.Root
                  value={appearance}
                  onValueChange={setAppearance}
                  disabled={!canEdit}
                  aria-labelledby="mode-label"
                >
                  {APPEARANCE_SLOTS.map((slot) => (
                    <Text as="label" size="2" key={slot.value}>
                      <Flex gap="2" align="center">
                        <RadioGroup.Item value={slot.value} />
                        {slot.label}
                      </Flex>
                    </Text>
                  ))}
                </RadioGroup.Root>
                <Text size="1" color="gray">
                  The section rail stays dark in both — in dark mode it sits a step
                  above the page so the two never blur together.
                </Text>
              </Flex>
            </Flex>

            <Separator size="4" />

            {/* THE PREVIEW. A real nested <Theme> carrying the same three
                slots the app shell would apply, so what a pilot sees here
                is the actual cascade rather than a drawing of it. This is
                one of the two files scripts/verify-tokens.mjs permits to
                pass a runtime value to a Theme prop; every value still
                comes from lib/theme-slots.ts. */}
            <Flex direction="column" gap="2">
              <Text as="div" size="2" weight="medium">
                Preview
              </Text>
              <Theme
                accentColor={previewAccent.value}
                scaling={previewDensity.scaling}
                appearance={previewAppearance.value}
                asChild
              >
                <Box
                  p="4"
                  style={{
                    borderRadius: "var(--radius-3)",
                    border: "1px solid var(--gray-a5)",
                  }}
                >
                  <Card>
                    <Flex direction="column" gap="3" p="1">
                      <Flex align="center" justify="between" gap="3" wrap="wrap">
                        <Text weight="bold">Trip to KTEB</Text>
                        <Badge color="green">Paid</Badge>
                      </Flex>
                      <Text size="2" color="gray">
                        Two flight days, one travel day. This card, this badge and the
                        button below are the real components at the size and colour you
                        just picked.
                      </Text>
                      <Flex gap="2">
                        <Button type="button" size="1">
                          Primary
                        </Button>
                        <Button type="button" size="1" variant="soft">
                          Secondary
                        </Button>
                      </Flex>
                    </Flex>
                  </Card>
                </Box>
              </Theme>
            </Flex>

            <div role="alert" aria-live="polite">
              {state.error ? (
                <Text size="1" color="red">
                  {state.error}
                </Text>
              ) : state.saved && !dirty ? (
                <Text size="1" color="green">
                  Saved.
                </Text>
              ) : dirty ? (
                <Text size="1" color="amber">
                  Not saved yet — the preview above is showing your choice. Save to
                  apply it to the whole account.
                </Text>
              ) : null}
            </div>

            {canEdit ? (
              <Flex>
                <Button type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save appearance"}
                </Button>
              </Flex>
            ) : (
              <Text size="1" color="gray">
                Only the account owner can change how this account looks.
              </Text>
            )}
          </Flex>
        </form>
      </Card>
    </Flex>
  );
}
