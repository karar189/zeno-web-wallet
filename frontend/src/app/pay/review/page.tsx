import { PaymentNav } from "@/components/payments/payment-nav";
import { ReviewPanel } from "@/components/payments/review-panel";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";

export default function ReviewPage() {
  return (
    <AppShell activePath="/pay">
      <PageHeader
        title="Review"
        description="Authorize the payment only after the recipient, amount, fee, and privacy limits look right."
      />
      <PaymentNav />
      <ReviewPanel />
    </AppShell>
  );
}
