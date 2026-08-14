"use client";

import { useActionState } from "react";
import { Button, Card, Flex, Grid, Heading, Text, TextField } from "@/components/ui";
import { updateSettings, type SettingsFormState } from "./actions";

export type SettingsValues = {
  legal_name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  invoice_prefix?: string | null;
};

const initialState: SettingsFormState = { error: null };

export default function SettingsForm({
  values,
  canEdit,
}: {
  values: SettingsValues;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateSettings, initialState);

  // React 19 resets an uncontrolled form on every dispatch, error path
  // included, so a rejected submit would blank every field without this.
  const submitted = state.values;
  const initial = (key: keyof SettingsValues, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    const stored = values[key];
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  return (
    <Card>
      <form action={formAction}>
        <Flex direction="column" gap="4" p="2">
          <Flex direction="column" gap="1">
            <Heading as="h2" size="4">Your business</Heading>
          </Flex>

          <Grid columns={{ initial: "1", md: "12" }} gap="3">
            <Flex direction="column" gap="1" gridColumn={{ md: "span 8" }}>
              <Text as="label" size="1" weight="medium" htmlFor="legal_name">
                Business name
              </Text>
              <TextField.Root
                id="legal_name"
                name="legal_name"
                required
                disabled={!canEdit}
                defaultValue={initial("legal_name")}
              />
              <Text size="1" color="gray" style={{ fontStyle: "italic" }}>
                Appears as the payee on every invoice
              </Text>
            </Flex>
            <Flex direction="column" gap="1" gridColumn={{ md: "span 4" }}>
              <Text as="label" size="1" weight="medium" htmlFor="invoice_prefix">
                Invoice prefix
              </Text>
              <TextField.Root
                id="invoice_prefix"
                name="invoice_prefix"
                disabled={!canEdit}
                defaultValue={initial("invoice_prefix", "INV")}
              />
              <Text size="1" color="gray" style={{ fontStyle: "italic" }}>
                Numbers already issued keep their old prefix
              </Text>
            </Flex>

            <Flex direction="column" gap="1" gridColumn={{ md: "span 6" }}>
              <Text as="label" size="1" weight="medium" htmlFor="address_line1">
                Address
              </Text>
              <TextField.Root
                id="address_line1"
                name="address_line1"
                disabled={!canEdit}
                defaultValue={initial("address_line1")}
              />
            </Flex>
            <Flex direction="column" gap="1" gridColumn={{ md: "span 6" }}>
              <Text as="label" size="1" weight="medium" htmlFor="address_line2">
                Address line 2
              </Text>
              <TextField.Root
                id="address_line2"
                name="address_line2"
                disabled={!canEdit}
                defaultValue={initial("address_line2")}
              />
            </Flex>
            <Flex direction="column" gap="1" gridColumn={{ md: "span 4" }}>
              <Text as="label" size="1" weight="medium" htmlFor="city">
                City
              </Text>
              <TextField.Root id="city" name="city" disabled={!canEdit} defaultValue={initial("city")} />
            </Flex>
            <Flex direction="column" gap="1" gridColumn={{ md: "span 2" }}>
              <Text as="label" size="1" weight="medium" htmlFor="state">
                State
              </Text>
              <TextField.Root id="state" name="state" disabled={!canEdit} defaultValue={initial("state")} />
            </Flex>
            <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
              <Text as="label" size="1" weight="medium" htmlFor="postal_code">
                Postal code
              </Text>
              <TextField.Root
                id="postal_code"
                name="postal_code"
                disabled={!canEdit}
                defaultValue={initial("postal_code")}
              />
            </Flex>
            <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
              <Text as="label" size="1" weight="medium" htmlFor="country">
                Country
              </Text>
              <TextField.Root
                id="country"
                name="country"
                disabled={!canEdit}
                defaultValue={initial("country")}
              />
            </Flex>
          </Grid>

          <div role="alert" aria-live="polite">
            {state.error ? (
              <Text size="1" color="red">
                {state.error}
              </Text>
            ) : state.saved ? (
              <Text size="1" color="green">
                Saved.
              </Text>
            ) : null}
          </div>

          {canEdit ? (
            <Flex>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </Flex>
          ) : (
            <Text size="1" color="gray">
              Only the account owner can change these.
            </Text>
          )}
        </Flex>
      </form>
    </Card>
  );
}
