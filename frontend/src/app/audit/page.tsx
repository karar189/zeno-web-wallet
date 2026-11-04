import { AppShell } from "@/components/layout/app-shell";
import { AuditorWorkspace } from "@/components/wallet/auditor-workspace";
export default function AuditPage() {
  return (
    <AppShell activePath="/audit">
      <AuditorWorkspace />
    </AppShell>
  );
}
