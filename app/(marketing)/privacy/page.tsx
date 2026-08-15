import { Callout, Container, Flex, Heading, Section, Text } from "@/components/ui";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { BRAND } from "@/lib/brand";

/**
 * noindex for the same reason as app/(marketing)/terms/page.tsx: this page
 * says in its own body that there is no published policy yet, and a
 * placeholder saying so should not be the search result for this product's
 * name. The URL stays stable and the footer links it. Remove the override when
 * counsel's text lands (docs/LAUNCH-GATES.md G3).
 */
export const metadata = {
  title: "Privacy Policy",
  robots: { index: false, follow: true },
};

/**
 * COUNSEL-GATED PLACEHOLDER — docs/LAUNCH-GATES.md G3. Same reasoning as
 * app/(marketing)/terms/page.tsx: this route holds the URL, not a policy.
 *
 * The bullet list below states only facts already true of the built
 * system (subprocessors, where receipts are stored, where OCR runs) —
 * every one of them is verifiable in this repo, not a promise this page is
 * making on its own authority. It deliberately stops short of any custody
 * claim: docs/PLAN.md §0's correction, which docs/LAUNCH-GATES.md G3
 * restates, is that no RLS policy and no application code path grants one
 * tenant anything about another, but the service-role key, the owning
 * Postgres role, and Supabase dashboard access all read every tenant's
 * data — an operational fact, not a database guarantee. The house rule is
 * "no application code path", never "we cannot technically see your
 * data," and this page follows it by not making the broader claim at all.
 */
export default function PrivacyPage() {
  return (
    <Section size="3">
      <Container size="2" px="4">
        <Flex direction="column" gap="5">
          <Heading size="7" trim="start">
            Privacy Policy
          </Heading>

          <Callout.Root color="amber">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              <Text weight="medium">Placeholder, pending review by aviation counsel.</Text>{" "}
              Nothing on this page is a binding privacy commitment.{" "}
              {BRAND.name} has not yet published a Privacy Policy, and no
              version of this text has been reviewed or approved.
            </Callout.Text>
          </Callout.Root>

          <Flex direction="column" gap="2">
            <Text size="2" color="gray">
              A few facts about how the product handles data today, ahead
              of the policy that will formally cover them:
            </Text>
            <Text size="2" color="gray">
              · Data processors: Supabase (database, file storage, and
              sign-in), Vercel (hosting), Stripe (billing and client
              payment links), and Resend (account email).
            </Text>
            <Text size="2" color="gray">
              · Receipts you upload are stored in a private file bucket,
              scoped to your account.
            </Text>
            <Text size="2" color="gray">
              · Receipt scanning runs in your own browser, not on a server:
              a receipt image is never uploaded just to be read.
            </Text>
          </Flex>

          <Text size="2" color="gray">
            This is not the complete policy. It does not yet address data
            retention, deletion, or every detail a full policy has to
            cover. That text is pending counsel review.
          </Text>
        </Flex>
      </Container>
    </Section>
  );
}
