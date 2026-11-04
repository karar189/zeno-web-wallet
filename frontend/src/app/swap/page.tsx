import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { SwapWorkspace } from "@/components/swap/swap-workspace";

export default function SwapPage() {
  return (
    <AppShell activePath="/swap">
      <Suspense fallback={<p className="workspace-page">Loading tokens…</p>}>
        <SwapWorkspace />
      </Suspense>
    </AppShell>
  );
}
