import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Box, Button, Callout, Flex, Heading, Separator, Text } from "@/components/ui";

/**
 * The pieces every auth screen is built from, so the five of them read as
 * one product rather than five forms that happen to share a stylesheet.
 *
 * No hooks and no event handlers here — these are presentation only, which
 * is why the file carries no "use client" directive: it compiles into
 * whichever graph imports it (the four form components are client, the
 * welcome page is server) instead of forcing a boundary on either.
 *
 * The layout (../layout.tsx) supplies the panel and the measure. These
 * supply the hierarchy inside it: one heading, one supporting line, fields
 * grouped with real space between them, one strong primary action, and
 * secondary links pushed below a rule where they cannot compete with it.
 */

/** The heading block. One h1 per screen, one supporting line, no more. */
export function AuthHeading({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <Flex direction="column" gap="2">
      <Heading as="h1" size="7" trim="start">
        {title}
      </Heading>
      {children ? (
        <Text as="p" size="2" color="gray">
          {children}
        </Text>
      ) : null}
    </Flex>
  );
}

/**
 * A labelled field. The hint is wired to the input with aria-describedby by
 * the caller passing the same id — the label/hint/control spacing is set
 * once here so no screen drifts into its own rhythm.
 */
export function Field({
  id,
  label,
  hint,
  optional = false,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Flex direction="column" gap="1">
      <Text as="label" size="2" weight="medium" htmlFor={id}>
        {label}
        {optional ? (
          <Text size="2" color="gray" weight="regular">
            {" "}
            (optional)
          </Text>
        ) : null}
      </Text>
      {children}
      {hint ? (
        <Text as="div" id={`${id}-hint`} size="1" color="gray">
          {hint}
        </Text>
      ) : null}
    </Flex>
  );
}

/**
 * THE ERROR STATE, and it is always rendered — an empty live region that
 * already exists announces its first message; one that appears at the same
 * moment often does not. So the region is permanent and only its contents
 * change, and a failed submit never shifts the form under the cursor by
 * more than the callout itself.
 */
export function FormError({ message }: { message: string | null }) {
  return (
    <div role="alert" aria-live="polite">
      {message ? (
        <Callout.Root color="red" size="1">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>{message}</Callout.Text>
        </Callout.Root>
      ) : null}
    </div>
  );
}

/**
 * The one primary action per screen. `loading` is Radix's own pending
 * treatment (a spinner in place of the label, and the button disabled), so
 * a submit cannot be double-fired and the wait is visible rather than
 * inferred; the label still changes underneath for anyone reading it back.
 */
export function SubmitButton({
  pending,
  idle,
  busy,
  ...rest
}: {
  pending: boolean;
  idle: string;
  busy: string;
} & Omit<React.ComponentProps<typeof Button>, "type" | "loading" | "children">) {
  return (
    <Button
      type="submit"
      size="3"
      disabled={pending}
      loading={pending}
      // minHeight, not a bigger size: a size="3" button is --space-7, which
      // is 36px at the Theme's 90% scaling and under the 44px minimum touch
      // target. The floor is stated here once rather than at five call sites.
      style={{ width: "100%", minHeight: "44px" }}
      {...rest}
    >
      {pending ? busy : idle}
    </Button>
  );
}

/** Secondary links, below a rule and deliberately quiet. */
export function AuthFooter({ children }: { children: React.ReactNode }) {
  return (
    <Box>
      <Separator size="4" mb="4" />
      <Flex direction="column" gap="2" align="center">
        {children}
      </Flex>
    </Box>
  );
}
