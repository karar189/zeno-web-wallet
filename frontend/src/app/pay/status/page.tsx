import { PaymentNav } from "@/components/payments/payment-nav";
import { ProgressPanel } from "@/components/payments/progress-panel";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";

export default function StatusPage() {
  return (
    <AppShell activePath="/pay">
      <PageHeader
        title="Payment progress"
        description="Submission, confirmation, and recipient detection are separate. One finishing does not imply the next."
      />
      <PaymentNav />
      <ProgressPanel />
    </AppShell>
  );
}
