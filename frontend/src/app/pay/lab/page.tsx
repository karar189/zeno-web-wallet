import { PaymentNav } from "@/components/payments/payment-nav";
import { PerformanceLab } from "@/components/payments/performance-lab";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";

export default function LabPage() {
  return (
    <AppShell activePath="/pay">
      <PageHeader
        title="Performance lab"
        description="A reproducible simulated comparison. It does not claim a faster Zcash block time, and the experimental probe stays off the payment path."
      />
      <PaymentNav />
      <PerformanceLab />
    </AppShell>
  );
}
