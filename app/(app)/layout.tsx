import AppShell from "@/components/mdpro/AppShell";
import { requireAccount } from "@/lib/supabase/account";
import { signOut } from "./actions";

/**
 * The authenticated surface. Every feature page lives under this group,
 * so this one server-side gate covers all of them: requireAccount()
 * redirects a signed-out visitor to /login and a signed-in-but-
 * unprovisioned one to /welcome before any dashboard chrome or tenant
 * data is rendered. Route groups don't change URLs, so pages here still
 * serve at "/", "/invoices", etc.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, account } = await requireAccount();

  return (
    <AppShell
      accountName={account.legal_name}
      userEmail={user.email ?? ""}
      signOutAction={signOut}
    >
      {children}
    </AppShell>
  );
}
