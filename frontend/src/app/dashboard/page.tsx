import { WalletHomeDashboard } from "@/components/dashboard/wallet-home-dashboard";
import { AppShell } from "@/components/layout/app-shell";

export default function DashboardPage() {
  return (
    <AppShell activePath="/dashboard">
      <WalletHomeDashboard />
    </AppShell>
  );
}
