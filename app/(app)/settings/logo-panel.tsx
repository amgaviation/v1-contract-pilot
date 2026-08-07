"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, Card, Flex, Heading, Text } from "@/components/ui";
import {
  uploadLogo,
  removeLogo,
  logoPreviewUrl,
  type SettingsFormState,
} from "./actions";

const initialState: SettingsFormState = { error: null };

export default function LogoPanel({
  hasLogo,
  canEdit,
}: {
  hasLogo: boolean;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(uploadLogo, initialState);
  const [removing, startRemove] = useTransition();
  const [previewing, startPreview] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <Flex direction="column" gap="3" p="1">
        <Flex direction="column" gap="1">
          <Heading size="4">Logo</Heading>
          <Text size="2" color="gray">
            Printed at the top of your invoices. PNG or JPEG, up to 2 MB.
          </Text>
        </Flex>

        {hasLogo ? (
          <Flex gap="3" align="center" wrap="wrap">
            <Text size="2" color="gray">
              A logo is on file.
            </Text>
            {/* Opened through a signed URL minted at click time rather than
                rendered inline — the same rule receipts follow, since a
                signed URL is a bearer token in a query string. */}
            <Button
              variant="outline"
              size="1"
              disabled={previewing}
              onClick={() =>
                startPreview(async () => {
                  setError(null);
                  const url = await logoPreviewUrl();
                  if (!url) {
                    setError("Couldn't open that logo.");
                    return;
                  }
                  window.open(url, "_blank", "noopener,noreferrer");
                })
              }
            >
              {previewing ? "Opening…" : "View"}
            </Button>
            {canEdit ? (
              <Button
                variant="outline"
                color="red"
                size="1"
                disabled={removing}
                onClick={() =>
                  startRemove(async () => {
                    setError(null);
                    const result = await removeLogo();
                    setError(result.error);
                  })
                }
              >
                {removing ? "Removing…" : "Remove"}
              </Button>
            ) : null}
          </Flex>
        ) : null}

        {canEdit ? (
          <form action={formAction}>
            <Flex direction="column" gap="2" align="start">
              <input
                type="file"
                name="logo"
                accept="image/png,image/jpeg"
                aria-label="Logo image"
              />
              <Button type="submit" variant="outline" disabled={pending}>
                {pending ? "Uploading…" : hasLogo ? "Replace logo" : "Upload logo"}
              </Button>
            </Flex>
          </form>
        ) : null}

        <div role="alert" aria-live="polite">
          {state.error ?? error ? (
            <Text size="1" color="red">
              {state.error ?? error}
            </Text>
          ) : state.saved ? (
            <Text size="1" color="green">
              Logo saved.
            </Text>
          ) : null}
        </div>
      </Flex>
    </Card>
  );
}
