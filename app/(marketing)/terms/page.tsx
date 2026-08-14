import { Callout, Container, Flex, Heading, Section, Text } from "@/components/ui";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { BRAND } from "@/lib/brand";

/**
 * noindex, overriding the marketing layout's `index: true`. This page says in
 * its own body that there are no Terms yet, and a placeholder saying so is the
 * last thing that should be a search result for this product's name. The URL
 * stays stable and reachable — the footer links it, and anyone who asks can
 * read exactly where things stand — it simply is not offered to crawlers until
 * there is a document here worth finding. Remove the override when counsel's
 * text lands (docs/LAUNCH-GATES.md G3).
 */
export const metadata = {
  title: "Terms of Service",
  robots: { index: false, follow: true },
};

/**
 * COUNSEL-GATED PLACEHOLDER — docs/LAUNCH-GATES.md G3.
 *
 * This route exists so the URL is stable and discoverable before launch,
 * NOT because there is a Terms of Service to publish. G3 is explicit that
 * an agent may "prepare, draft, and say 'this is ready for review'" but
 * must "never soften a disclaimer, never publish a claim" — writing
 * plausible-sounding terms language here would be exactly the thing that
 * gate exists to prevent, so this page states its own status instead of
 * simulating a document aviation counsel has not yet drafted or approved.
 *
 * Two things G3 already establishes as true today, so this page does not
 * imply otherwise by omission: signup captures no acceptance of anything
 * (app/(auth)/signup/signup-form.tsx has no checkbox, and recording
 * acceptance needs a migration that does not exist yet), and there is no
 * self-serve cancellation path — "cancel anytime" is not a claim this
 * page makes.
 */
export default function TermsPage() {
  return (
    <Section size="3">
      <Container size="2" px="4">
        <Flex direction="column" gap="5">
          <Heading size="7" trim="start">
            Terms of Service
          </Heading>

          <Callout.Root color="amber">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              <Text weight="medium">Placeholder, pending review by aviation counsel.</Text>{" "}
              Nothing on this page is a binding agreement. {BRAND.name} has
              not yet published Terms of Service, and no version of this
              text has been reviewed or approved by counsel or by the
              product owner.
            </Callout.Text>
          </Callout.Root>

          <Text size="2" color="gray">
            When this page is published for real, it will cover the terms
            of using {BRAND.name} (including billing, the trial, and
            cancellation), and creating an account will ask you to accept
            it explicitly. Until then, this URL exists so it has a stable
            address; it does not yet describe any agreement you are bound
            by.
          </Text>
        </Flex>
      </Container>
    </Section>
  );
}
