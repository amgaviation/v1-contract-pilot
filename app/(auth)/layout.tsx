import { Flex } from "@/components/ui";

/**
 * The signed-out surface (/login, /welcome). Theme-only chrome, no
 * dashboard navigation. Each page here does its own session check:
 * /login bounces an already-signed-in user into the app, /welcome is the
 * resting place for a signed-in user with no provisioned tenant yet.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Flex align="center" justify="center" minHeight="100vh" p="4">
      {children}
    </Flex>
  );
}
