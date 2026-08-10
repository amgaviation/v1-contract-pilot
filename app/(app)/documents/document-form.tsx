"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import NextLink from "next/link";
import { Button, Card, Flex, Grid, Heading, Select, Text, TextArea, TextField } from "@/components/ui";
import { DOCUMENT_KINDS } from "./kinds";
import { useFileSurvivesReset } from "@/components/use-file-survives-reset";
import type { DocumentFormState } from "./actions";

export type DocumentFormValues = {
  id?: string;
  kind?: string | null;
  label?: string | null;
  issued_on?: string | null;
  expires_on?: string | null;
  client_id?: string | null;
  notes?: string | null;
  file_path?: string | null;
};

export type ClientOption = {
  id: string;
  label: string;
};

// Radix Select.Item forbids an empty-string value; "No client" needs one,
// so it's this sentinel translated back to "" before it reaches the
// action's `client_id` field.
const NO_CLIENT = "__none__";

const initialState: DocumentFormState = { error: null };

export default function DocumentForm({
  action,
  clients,
  values = {},
  submitLabel,
}: {
  action: (
    state: DocumentFormState,
    formData: FormData
  ) => Promise<DocumentFormState>;
  clients: ClientOption[];
  values?: DocumentFormValues;
  submitLabel: string;
}) {
  async function wrappedAction(prevState: DocumentFormState, formData: FormData) {
    if (formData.get("client_id") === NO_CLIENT) formData.set("client_id", "");
    return action(prevState, formData);
  }
  const [state, formAction, pending] = useActionState(wrappedAction, initialState);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { fileName, lost: fileLost, onFileChange } = useFileSurvivesReset(fileInputRef);

  const submitted = state.values;
  const initial = (key: string, stored: unknown, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  // Radix's Select.Root always renders its posting <select> with
  // `defaultValue`, never `value` (@radix-ui/react-select's
  // SelectBubbleInput) — so it's uncontrolled from React's point of view
  // no matter what Select.Root is given, and it's what the browser
  // actually posts if `name` stays on it. React 19's post-action
  // form.reset() restores it to its mount-time option even on a rejected
  // submit, so `name` is dropped from both Selects below and their real
  // values post from controlled hidden inputs instead.
  const [kind, setKind] = useState(() => submitted?.kind ?? (values.kind ?? "other"));
  const [clientId, setClientId] = useState(() => {
    const stored = initial("client_id", values.client_id);
    return stored === "" ? NO_CLIENT : stored;
  });
  useEffect(() => {
    if (submitted?.kind !== undefined) setKind(String(submitted.kind || "other"));
    if (submitted?.client_id !== undefined) {
      setClientId(submitted.client_id ? String(submitted.client_id) : NO_CLIENT);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  return (
    <Card>
      <form action={formAction}>
        <Flex direction="column" gap="4" p="2">
          {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

          <Heading as="h2" size="4">What it is</Heading>
          <Grid columns={{ initial: "1", md: "3" }} gap="3">
            <Flex direction="column" gap="1">
              <Text as="label" size="1" color="gray" id="kind-label">
                Kind
              </Text>
              <Select.Root value={kind} onValueChange={setKind}>
                <Select.Trigger aria-labelledby="kind-label" />
                <Select.Content>
                  {DOCUMENT_KINDS.map((option) => (
                    <Select.Item key={option.value} value={option.value}>
                      {option.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              <input type="hidden" name="kind" value={kind} />
            </Flex>
            <Flex direction="column" gap="1" gridColumn={{ md: "span 2" }}>
              <Text as="label" size="1" color="gray" htmlFor="label">
                Label
              </Text>
              <TextField.Root
                id="label"
                name="label"
                required
                defaultValue={initial("label", values.label)}
              />
              <Text size="1" color="gray">
                However you&rsquo;d recognize it — e.g. &ldquo;First class medical&rdquo; or
                &ldquo;N123AB hull policy&rdquo;
              </Text>
            </Flex>
          </Grid>

          <Flex direction="column" gap="1">
            <Heading as="h2" size="4">Dates</Heading>
            <Text size="2" color="gray">
              Enter the dates exactly as printed on the document. Nothing here is calculated
              from the other — an issue date does not imply an expiration.
            </Text>
          </Flex>
          <Grid columns={{ initial: "1", md: "2" }} gap="3">
            <Flex direction="column" gap="1">
              <Text as="label" size="1" color="gray" htmlFor="issued_on">
                Issued
              </Text>
              <TextField.Root
                id="issued_on"
                type="date"
                name="issued_on"
                defaultValue={initial("issued_on", values.issued_on)}
              />
              <Text size="1" color="gray">
                Optional
              </Text>
            </Flex>
            <Flex direction="column" gap="1">
              <Text as="label" size="1" color="gray" htmlFor="expires_on">
                Expires
              </Text>
              <TextField.Root
                id="expires_on"
                type="date"
                name="expires_on"
                defaultValue={initial("expires_on", values.expires_on)}
              />
              <Text size="1" color="gray">
                Leave blank if this document doesn&rsquo;t expire
              </Text>
            </Flex>
          </Grid>

          <Heading as="h2" size="4">Linked client</Heading>
          <Grid columns={{ initial: "1", md: "2" }} gap="3">
            <Flex direction="column" gap="1">
              <Text as="label" size="1" color="gray" id="client-label">
                Client
              </Text>
              <Select.Root
                value={clientId}
                onValueChange={setClientId}
              >
                <Select.Trigger aria-labelledby="client-label" />
                <Select.Content>
                  <Select.Item value={NO_CLIENT}>No client</Select.Item>
                  {clients.map((client) => (
                    <Select.Item key={client.id} value={client.id}>
                      {client.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              <input type="hidden" name="client_id" value={clientId === NO_CLIENT ? "" : clientId} />
              <Text size="1" color="gray">
                Optional — e.g. an insurance certificate or W-9 that names one client
              </Text>
            </Flex>
            <Flex direction="column" gap="1">
              <Text as="label" size="1" color="gray" htmlFor="notes">
                Notes
              </Text>
              <TextArea id="notes" name="notes" rows={2} defaultValue={initial("notes", values.notes)} />
            </Flex>
          </Grid>

          <Heading as="h2" size="4">Scan or photo</Heading>
          <Flex direction="column" gap="1">
            {/* A plain file input: the file is stored privately and read back
                through a short-lived signed URL, never a public URL.
                The ref and onChange are what keep the chosen file attached
                across React 19's post-action form.reset() — without them a
                rejected submit on any OTHER field saved the document with
                no file while this screen still said one was attached. */}
            <input
              ref={fileInputRef}
              type="file"
              name="file"
              accept="image/jpeg,image/png,image/heic,image/webp,application/pdf"
              aria-label="Document scan or photo"
              onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
            />
            {fileLost ? (
              <Text size="1" color="red">
                This browser cleared the file you picked. Choose it again before
                saving — the rest of the form is as you left it.
              </Text>
            ) : (
              <Text size="1" color="gray">
                {fileName
                  ? `${fileName} will be attached.`
                  : values.file_path
                    ? "A file is already attached. Choosing a file replaces it."
                    : "JPEG, PNG, HEIC, WebP or PDF, up to 10 MB. Optional."}
              </Text>
            )}
          </Flex>

          <div role="alert" aria-live="polite">
            {state.error ? (
              <Text size="1" color="red">
                {state.error}
              </Text>
            ) : null}
          </div>

          <Flex gap="3">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
            <Button asChild variant="outline">
              <NextLink href="/documents">Cancel</NextLink>
            </Button>
          </Flex>
        </Flex>
      </form>
    </Card>
  );
}
