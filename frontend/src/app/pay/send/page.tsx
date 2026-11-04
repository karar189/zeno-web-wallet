import { Suspense } from "react";
import { SendForm } from "@/components/payments/send-form";
import { AppShell } from "@/components/layout/app-shell";

export default function SendPage() {
  return (
    <AppShell activePath="/pay/send" chrome="focus">
      <Suspense fallback={<p className="px-5 pt-8 text-sm text-[#8B928E]">Loading…</p>}>
        <SendForm />
      </Suspense>
    </AppShell>
  );
}