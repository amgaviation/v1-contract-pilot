"use client";

import { useActionState } from "react";
import { Box, Button, Card, Flex, Text, TextField } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { setNewPassword, type ResetPasswordState } from "./actions";

const initialState: ResetPasswordState = { error: null };

export default function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(
    setNewPassword,
    initialState
  );

  return (
    <Card size="4" style={{ width: "100%", maxWidth: "22rem" }}>
      <form action={formAction}>
        <Flex direction="column" gap="3">
          <Flex direction="column" align="center" gap="1" mb="1">
            <Text size="6" weight="bold">
              {BRAND.name}
            </Text>
            <Text size="2" color="gray">
              Choose a new password
            </Text>
          </Flex>

          <Box>
            <Text as="label" size="2" weight="medium" htmlFor="password">
              New password
            </Text>
            <TextField.Root
              id="password"
              type="password"
              name="password"
              autoComplete="new-password"
              required
              mt="1"
            />
          </Box>
          <Box>
            <Text as="label" size="2" weight="medium" htmlFor="confirm">
              Confirm new password
            </Text>
            <TextField.Root
              id="confirm"
              type="password"
              name="confirm"
              autoComplete="new-password"
              required
              mt="1"
            />
          </Box>

          {state.error ? (
            <Text size="1" color="red" role="alert" aria-live="polite">
              {state.error}
            </Text>
          ) : null}

          <Button type="submit" disabled={pending} mt="1">
            {pending ? "Saving…" : "Save password"}
          </Button>
        </Flex>
      </form>
    </Card>
  );
}
