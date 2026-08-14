import type { Metadata } from "next";
import { Container, Flex, Heading } from "@/components/ui";
import { requireAccount } from "@/lib/supabase/account";
import HelpBrowser from "./help-browser";

export const metadata: Metadata = { title: "Help" };

/**
 * THE USER GUIDE.
 *
 * This screen exists because the explanations it holds used to be scattered
 * one paragraph at a time under the heading of every screen in the product.
 * That is the wrong place for them: they are read once and then occupy
 * permanent space above the thing a pilot actually came to do, on a phone,
 * in an FBO, between legs. Moved here they are looked up on purpose, they
 * can be searched, and the screens go back to being the work.
 *
 * Behind the session like every other app screen. The guide describes what
 * this account can do and links straight into it, so it is not public
 * documentation and does not pretend to be.
 *
 * The content and the search are in lib/help/guide.ts; the interactive half
 * is help-browser.tsx. This file is only the frame.
 */
export default async function HelpPage() {
  // Same gate as every other screen in this group — nothing here is secret,
  // but a signed-out visitor has no account for it to describe.
  await requireAccount("/help");

  return (
    <Container size="3">
      <Flex direction="column" gap="5" py="5">
        <Heading as="h1" size="6">
          Help
        </Heading>
        <HelpBrowser />
      </Flex>
    </Container>
  );
}
