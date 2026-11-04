import { IntelligencePlaceholder } from "@/components/intelligence/intelligence-placeholder";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";

export default function IntelligencePage() {
  return (
    <AppShell activePath="/intelligence">
      <PageHeader
        title="Intelligence"
        description="Liquidity, cost, and dependency signals for routing decisions."
      />
      <IntelligencePlaceholder />
    </AppShell>
  );
}
