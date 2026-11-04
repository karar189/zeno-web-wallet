import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { ProfileScreen } from "@/components/profile/profile-screen";

export default function ProfilePage() {
  return (
    <AppShell activePath="/profile">
      <PageHeader
        title="Profile"
        description="Your wallet identity on testnet. No personal data is stored on a server."
      />
      <ProfileScreen />
    </AppShell>
  );
}
