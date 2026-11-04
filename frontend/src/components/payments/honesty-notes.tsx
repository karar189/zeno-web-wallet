"use client";

import { usePaymentStore } from "@/stores/payment-store";

export function HonestyNotes() {
  const notes = usePaymentStore((state) => state.honestyNotes);
  return (
    <details className="payment-details">
      <summary>How this payment works</summary>
      <ul className="text-muted-foreground mt-3 list-disc space-y-2 pl-5 text-xs leading-6">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </details>
  );
}
