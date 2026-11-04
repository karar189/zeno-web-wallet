import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { DisclosurePanel } from "@/components/wallet/disclosure-panel";

export default function DisclosureSettingsPage() {
  return (
    <AppShell activePath="/settings/disclosure">
      <PageHeader
        title="Auditor view"
        description="Create a dedicated disclosure account and export a viewing key. Spending keys are never shared."
      />
      <DisclosurePanel />
    </AppShell>
  );
}
