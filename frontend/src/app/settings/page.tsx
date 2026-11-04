import { AppShell } from "@/components/layout/app-shell";
import { SettingsScreen } from "@/components/settings/settings-screen";

export default function SettingsPage() {
  return (
    <AppShell activePath="/settings">
      <SettingsScreen />
    </AppShell>
  );
}
