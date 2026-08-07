import Link from "next/link";
import { Box, Button, Container, Flex, Separator, Text } from "@/components/ui";
import { Logo } from "@/components/ui/logo";
import { BRAND } from "@/lib/brand";
import { requireAccount } from "@/lib/supabase/account";
import NavRail from "./nav-rail";
import { signOut } from "./actions";

/**
 * The authenticated surface. Every feature page lives under this group,
 * so this one server-side gate covers all of them: requireAccount()
 * redirects a signed-out visitor to /login and a signed-in-but-
 * unprovisioned one to /welcome before any chrome or tenant data is
 * rendered. Route groups don't change URLs, so pages here still serve at
 * "/", "/invoices", etc.
 *
 * The shell is a server component and the rail is the only client piece
 * (it needs the current path). The kit this replaced inverted that — a
 * client shell wrapping everything — which forced client boundaries much
 * further down the tree than any of these screens actually need.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, account } = await requireAccount();

  return (
    <Flex direction={{ initial: "column", sm: "row" }} minHeight="100vh">
      <Box
        asChild
        width={{ initial: "100%", sm: "232px" }}
        flexShrink="0"
        style={{
          borderRight: "1px solid var(--gray-a5)",
          background: "var(--gray-a2)",
        }}
      >
        <aside>
          <Flex direction="column" height="100%">
            <Box p="4">
              <Link href="/" aria-label={`${BRAND.name} — ${BRAND.descriptor}`}>
                <Logo />
              </Link>
              <Text as="div" size="1" color="gray" mt="1">
                {BRAND.descriptor}
              </Text>
            </Box>
            <NavRail accountName={account.legal_name} />
          </Flex>
        </aside>
      </Box>

      <Flex direction="column" flexGrow="1" minWidth="0">
        <Flex
          asChild
          align="center"
          justify="end"
          gap="3"
          px="4"
          py="2"
          style={{ borderBottom: "1px solid var(--gray-a5)" }}
        >
          <header>
            <Text size="1" color="gray">
              {user.email}
            </Text>
            {/* A form, not a link: signing out mutates session state, and
                a GET that a prefetcher or a link-scanner can fire would
                end the session behind the pilot's back. */}
            <form action={signOut}>
              <Button type="submit" size="1" variant="soft" color="gray">
                Sign out
              </Button>
            </form>
          </header>
        </Flex>

        <Box flexGrow="1" p={{ initial: "4", md: "5" }}>
          <Container size="4">{children}</Container>
        </Box>

        <Box px="5" py="4">
          <Separator size="4" mb="4" />
          {/* The one place AMG is named in the whole product — decision
              #18. Not the rail, not the header, never an invoice PDF. */}
          <Text size="1" color="gray">
            {BRAND.attribution}
          </Text>
        </Box>
      </Flex>
    </Flex>
  );
}
