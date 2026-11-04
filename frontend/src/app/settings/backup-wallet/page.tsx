import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { WalletScreen } from "@/components/wallet/wallet-screen";

export default function BackupWalletSettingsPage() {
  return (
    <AppShell activePath="/settings">
      <PageHeader
        title="Local backup wallet"
        description="Optional browser vault that encrypts a 24-word seed on this device. It is separate from your funded testnet wallet and cannot broadcast yet."
      />
      <WalletScreen />
    </AppShell>
  );
}
