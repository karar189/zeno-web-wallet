import { ActivityPlaceholder } from "@/components/activity/activity-placeholder";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";

export default function ActivityPage() {
  return (
    <AppShell activePath="/activity">
      <PageHeader title="Activity" description="Notifications and settlement history." />
      <ActivityPlaceholder />
    </AppShell>
  );
}
